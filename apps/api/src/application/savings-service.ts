import {
  ContextExperimentSettingsSchema,
  type CacheReport,
  type ContextExperimentSettings,
  type OtherSavings,
  type PackAccounting,
  type RunStatus,
  type SavingsReport,
} from "@onyx/contracts";
import type { PrismaClient } from "@onyx/db";
import { summarizeCache } from "../domain/prompt-cache";
import {
  compareArms,
  DEFAULT_EXPERIMENT,
  savingRatio,
  savingsChecks,
  savingsLedger,
  savingsVerdict,
  type ArmSample,
} from "../domain/savings";
import { toStringArray } from "./mappers";
import type { RouterService } from "./router-service";

export const EXPERIMENT_SETTING_KEY = "context.experiment";

const DAY_MS = 86_400_000;
const ACCOUNTING_DAYS = 30;
const EXPERIMENT_DAYS = 90;
const TOP_REREADS = 5;
const MEASURED_STATUSES: RunStatus[] = ["COMPLETED", "FAILED", "TIMEOUT", "INTERRUPTED"];

export interface SavingsServiceDeps {
  prisma: PrismaClient;
  router: Pick<RouterService, "telemetry">;
  contextEnabled: boolean;
}

function round(value: number, digits = 6): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export class SavingsService {
  constructor(private readonly deps: SavingsServiceDeps) {}

  async experimentSettings(): Promise<ContextExperimentSettings> {
    const row = await this.deps.prisma.appSetting.findUnique({
      where: { key: EXPERIMENT_SETTING_KEY },
    });
    const parsed = ContextExperimentSettingsSchema.safeParse(row?.value);
    return parsed.success ? parsed.data : DEFAULT_EXPERIMENT;
  }

  async updateExperiment(
    input: ContextExperimentSettings,
    actor: string,
  ): Promise<ContextExperimentSettings> {
    await this.deps.prisma.$transaction(async (tx) => {
      await tx.appSetting.upsert({
        where: { key: EXPERIMENT_SETTING_KEY },
        create: { key: EXPERIMENT_SETTING_KEY, value: input },
        update: { value: input },
      });
      await tx.auditLog.create({
        data: { actor, action: "context.experiment", target: null, meta: { changes: input } },
      });
    });
    return input;
  }

  async report(now = new Date()): Promise<SavingsReport> {
    const [settings, pack, experimentRuns, other, sessions] = await Promise.all([
      this.experimentSettings(),
      this.accounting(now),
      this.experimentSamples(now),
      this.otherSavings(now),
      this.sessionReuse(now),
    ]);
    const experiment = compareArms({
      settings,
      pack: experimentRuns.pack,
      control: experimentRuns.control,
      windowDays: EXPERIMENT_DAYS,
      since: experimentRuns.since,
    });
    return {
      generatedAt: now.toISOString(),
      contextEnabled: this.deps.contextEnabled,
      verdict: savingsVerdict(experiment, pack),
      experiment,
      pack,
      checks: savingsChecks({ contextEnabled: this.deps.contextEnabled, pack, experiment }),
      other,
      ledger: savingsLedger({
        pack,
        experiment,
        other,
        reuse: sessions.reuse,
        prefix: sessions.prefix,
      }),
      cache: sessions.cache,
    };
  }

  private async sessionReuse(now: Date): Promise<{
    cache: CacheReport;
    reuse: { runs: number; tokens: number };
    prefix: { runs: number; readTokens: number };
  }> {
    const since = new Date(now.getTime() - ACCOUNTING_DAYS * DAY_MS);
    const { prisma } = this.deps;
    const [runs, reuse, prefix] = await Promise.all([
      prisma.agentRun.groupBy({
        by: ["cacheLoss"],
        where: { startedAt: { gte: since }, cacheLoss: { not: null } },
        _count: { _all: true },
        _sum: { cacheLostTokens: true, cacheReadTokens: true },
      }),
      prisma.agentRun.aggregate({
        where: { startedAt: { gte: since }, ctxReusedTokens: { gt: 0 } },
        _count: { _all: true },
        _sum: { ctxReusedTokens: true },
      }),
      prisma.agentRun.aggregate({
        where: { startedAt: { gte: since }, ctxMapDrift: true, cacheLoss: "NONE" },
        _count: { _all: true },
        _sum: { cacheReadTokens: true },
      }),
    ]);
    return {
      cache: {
        windowDays: ACCOUNTING_DAYS,
        ...summarizeCache(
          runs.flatMap((group) =>
            group.cacheLoss === null
              ? []
              : [
                  {
                    reason: group.cacheLoss,
                    runs: group._count._all,
                    lostTokens: group._sum.cacheLostTokens ?? 0,
                    readTokens: group._sum.cacheReadTokens ?? 0,
                  },
                ],
          ),
        ),
      },
      reuse: { runs: reuse._count._all, tokens: reuse._sum.ctxReusedTokens ?? 0 },
      prefix: { runs: prefix._count._all, readTokens: prefix._sum.cacheReadTokens ?? 0 },
    };
  }

  private async accounting(now: Date): Promise<PackAccounting> {
    const runs = await this.deps.prisma.agentRun.findMany({
      where: {
        status: { in: MEASURED_STATUSES },
        startedAt: { gte: new Date(now.getTime() - ACCOUNTING_DAYS * DAY_MS) },
        ctxReadFiles: { not: null },
      },
      select: {
        contextArm: true,
        ctxBaselineTokens: true,
        ctxDeliveredTokens: true,
        ctxExpansions: true,
        ctxReadFiles: true,
        ctxRereadFiles: true,
        ctxRereadTokens: true,
        ctxMissedFiles: true,
        ctxRereadPaths: true,
      },
    });
    const withPack = runs.filter(
      (run) => run.contextArm !== "CONTROL" && (run.ctxBaselineTokens ?? 0) > 0,
    );
    const sum = (pick: (run: (typeof withPack)[number]) => number | null) =>
      withPack.reduce((total, run) => total + (pick(run) ?? 0), 0);
    const baselineTokens = sum((run) => run.ctxBaselineTokens);
    const deliveredTokens = sum((run) => run.ctxDeliveredTokens);
    const rereadTokens = sum((run) => run.ctxRereadTokens);
    const rereadCounts = new Map<string, number>();
    for (const run of withPack) {
      for (const path of toStringArray(run.ctxRereadPaths)) {
        rereadCounts.set(path, (rereadCounts.get(path) ?? 0) + 1);
      }
    }
    const gross = savingRatio(baselineTokens, deliveredTokens);
    const net = savingRatio(baselineTokens, deliveredTokens + rereadTokens);
    return {
      windowDays: ACCOUNTING_DAYS,
      runs: runs.length,
      runsWithPack: withPack.length,
      controlRuns: runs.filter((run) => run.contextArm === "CONTROL").length,
      baselineTokens,
      deliveredTokens,
      rereadTokens,
      grossSaving: gross === null ? null : round(gross, 4),
      netSaving: net === null ? null : round(net, 4),
      runsWithRereads: withPack.filter((run) => (run.ctxRereadFiles ?? 0) > 0).length,
      rereadFiles: sum((run) => run.ctxRereadFiles),
      readFiles: sum((run) => run.ctxReadFiles),
      missedFiles: sum((run) => run.ctxMissedFiles),
      expansions: sum((run) => run.ctxExpansions),
      topRereads: [...rereadCounts.entries()]
        .sort(
          ([leftPath, left], [rightPath, right]) =>
            right - left || leftPath.localeCompare(rightPath),
        )
        .slice(0, TOP_REREADS)
        .map(([relPath, count]) => ({ relPath, runs: count })),
    };
  }

  private async experimentSamples(
    now: Date,
  ): Promise<{ pack: ArmSample[]; control: ArmSample[]; since: string | null }> {
    const runs = await this.deps.prisma.agentRun.findMany({
      where: {
        contextArm: { not: null },
        status: { in: MEASURED_STATUSES },
        startedAt: { gte: new Date(now.getTime() - EXPERIMENT_DAYS * DAY_MS) },
      },
      orderBy: { startedAt: "asc" },
      select: {
        contextArm: true,
        status: true,
        costUsd: true,
        numTurns: true,
        ctxReadFiles: true,
        startedAt: true,
        tokenLogs: { where: { scope: "RUN_TOTAL" }, take: 1 },
      },
    });
    const pack: ArmSample[] = [];
    const control: ArmSample[] = [];
    for (const run of runs) {
      const log = run.tokenLogs[0];
      if (!log) continue;
      const sample: ArmSample = {
        completed: run.status === "COMPLETED",
        contextTokens: log.inputTokens + log.cacheCreationTokens + log.cacheReadTokens,
        outputTokens: log.outputTokens,
        costUsd: run.costUsd ?? log.costUsd,
        turns: run.numTurns,
        readFiles: run.ctxReadFiles ?? 0,
      };
      (run.contextArm === "CONTROL" ? control : pack).push(sample);
    }
    return { pack, control, since: runs[0]?.startedAt.toISOString() ?? null };
  }

  private async otherSavings(now: Date): Promise<OtherSavings> {
    const { prisma, router } = this.deps;
    const [cache, models, routing] = await Promise.all([
      prisma.tokenLog.groupBy({
        by: ["modelId"],
        where: {
          scope: "RUN_TOTAL",
          createdAt: { gte: new Date(now.getTime() - ACCOUNTING_DAYS * DAY_MS) },
        },
        _sum: { cacheReadTokens: true },
      }),
      prisma.modelProfile.findMany(),
      router.telemetry(null),
    ]);
    let cacheReadTokens = 0;
    let cacheSavedUsd = 0;
    for (const row of cache) {
      const tokens = row._sum.cacheReadTokens ?? 0;
      cacheReadTokens += tokens;
      const profile = models.find((model) => model.id === row.modelId);
      if (!profile) continue;
      const readPrice = profile.cacheReadUsdPerMTok ?? profile.inputUsdPerMTok * 0.1;
      cacheSavedUsd += (tokens * (profile.inputUsdPerMTok - readPrice)) / 1_000_000;
    }
    return {
      windowDays: ACCOUNTING_DAYS,
      cacheReadTokens,
      cacheSavedUsd: round(cacheSavedUsd),
      routingReferenceModelId: routing.referenceModelId,
      routingSavedUsd:
        routing.completedTasks > 0 ? round(routing.counterfactualUsd - routing.costUsd) : null,
      routingSavingRatio: routing.savingRatio,
    };
  }
}
