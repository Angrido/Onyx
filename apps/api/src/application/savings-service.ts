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
import { CONTINUE_PROMPT_PREFIX } from "../domain/command-rules";
import { compareMemoryArms } from "../domain/memory";
import { experimentRuns, sqlDate } from "../infrastructure/run-totals";
import type { MemoryService } from "./memory-service";

const EMPTY_MEMORY_EXPERIMENT = compareMemoryArms({
  enabled: false,
  withMemory: [],
  without: [],
  windowDays: 90,
});
import { summarizeCache } from "../domain/prompt-cache";
import {
  compareArms,
  DEFAULT_EXPERIMENT,
  savingRatio,
  savingsChecks,
  savingsLedger,
  savingsVerdict,
  type ArmSample,
  type RunTokens,
} from "../domain/savings";
import { toStringArray } from "./mappers";
import type { RouterService } from "./router-service";

export const EXPERIMENT_SETTING_KEY = "context.experiment";

const DAY_MS = 86_400_000;
const ACCOUNTING_DAYS = 30;
const EXPERIMENT_DAYS = 90;
const TOP_REREADS = 5;
const REPORT_CACHE_MS = 30_000;
const MEASURED_STATUSES: RunStatus[] = ["COMPLETED", "FAILED", "TIMEOUT", "INTERRUPTED"];

export interface SavingsServiceDeps {
  prisma: PrismaClient;
  router: Pick<RouterService, "telemetry">;
  contextEnabled: boolean;
  memory?: Pick<MemoryService, "experiment">;
}

function round(value: number, digits = 6): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export class SavingsService {
  private cached: { at: number; report: SavingsReport } | null = null;

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
    this.cached = null;
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

  forget(): void {
    this.cached = null;
  }

  async report(now?: Date): Promise<SavingsReport> {
    if (now === undefined && this.cached && Date.now() - this.cached.at < REPORT_CACHE_MS)
      return this.cached.report;
    const report = await this.compute(now ?? new Date());
    if (now === undefined) this.cached = { at: Date.now(), report };
    return report;
  }

  private async compute(now: Date): Promise<SavingsReport> {
    const [
      settings,
      pack,
      experimentRuns,
      other,
      sessions,
      current,
      previous,
      quota,
      memory,
      signatures,
    ] = await Promise.all([
      this.experimentSettings(),
      this.accounting(now),
      this.experimentSamples(now),
      this.otherSavings(now),
      this.sessionReuse(now),
      this.continuations(now, 0),
      this.continuations(now, 1),
      this.quotaRuns(now),
      this.memoryUse(now),
      this.signatureUse(now),
    ]);
    const experiment = compareArms({
      settings,
      pack: experimentRuns.pack,
      control: experimentRuns.control,
      variant: experimentRuns.variant,
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
        continuations: { current, previous, windowDays: ACCOUNTING_DAYS },
        quota,
        memory,
        signatures,
      }),
      cache: sessions.cache,
      memory: memory.experiment,
    };
  }

  private async continuations(now: Date, windowsBack: number): Promise<RunTokens> {
    const until = new Date(now.getTime() - windowsBack * ACCOUNTING_DAYS * DAY_MS);
    const since = new Date(until.getTime() - ACCOUNTING_DAYS * DAY_MS);
    const runs = await this.deps.prisma.agentRun.findMany({
      where: {
        startedAt: { gte: since, lt: until },
        prompt: { startsWith: CONTINUE_PROMPT_PREFIX },
      },
      select: { id: true },
    });
    if (runs.length === 0) return { runs: 0, tokens: 0 };
    const usage = await this.deps.prisma.tokenLog.aggregate({
      where: { runId: { in: runs.map((run) => run.id) } },
      _sum: {
        inputTokens: true,
        outputTokens: true,
        cacheCreationTokens: true,
        cacheReadTokens: true,
      },
    });
    return {
      runs: runs.length,
      tokens:
        (usage._sum.inputTokens ?? 0) +
        (usage._sum.outputTokens ?? 0) +
        (usage._sum.cacheCreationTokens ?? 0) +
        (usage._sum.cacheReadTokens ?? 0),
    };
  }

  private async quotaRuns(
    now: Date,
  ): Promise<{ deferredRuns: number; limitedRuns: number; windowDays: number }> {
    const since = new Date(now.getTime() - ACCOUNTING_DAYS * DAY_MS);
    const [deferredRuns, limitedRuns] = await Promise.all([
      this.deps.prisma.agentRun.count({
        where: { startedAt: { gte: since }, quotaDeferred: true },
      }),
      this.deps.prisma.agentRun.count({ where: { startedAt: { gte: since }, quotaLimited: true } }),
    ]);
    return { deferredRuns, limitedRuns, windowDays: ACCOUNTING_DAYS };
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
    const { prisma } = this.deps;
    const window = {
      status: { in: MEASURED_STATUSES },
      startedAt: { gte: new Date(now.getTime() - ACCOUNTING_DAYS * DAY_MS) },
      ctxReadFiles: { not: null },
    };
    const withPackWhere = {
      ...window,
      OR: [{ contextArm: null }, { contextArm: { not: "CONTROL" as const } }],
      ctxBaselineTokens: { gt: 0 },
    };
    const [runs, controlRuns, withPack, runsWithRereads, rereads] = await Promise.all([
      prisma.agentRun.count({ where: window }),
      prisma.agentRun.count({ where: { ...window, contextArm: "CONTROL" } }),
      prisma.agentRun.aggregate({
        where: withPackWhere,
        _count: { _all: true },
        _sum: {
          ctxBaselineTokens: true,
          ctxDeliveredTokens: true,
          ctxRereadTokens: true,
          ctxRereadFiles: true,
          ctxReadFiles: true,
          ctxMissedFiles: true,
          ctxExpansions: true,
        },
      }),
      prisma.agentRun.count({ where: { ...withPackWhere, ctxRereadFiles: { gt: 0 } } }),
      prisma.agentRun.findMany({
        where: { ...withPackWhere, ctxRereadFiles: { gt: 0 } },
        select: { ctxRereadPaths: true },
      }),
    ]);
    const totals = withPack._sum;
    const baselineTokens = totals.ctxBaselineTokens ?? 0;
    const deliveredTokens = totals.ctxDeliveredTokens ?? 0;
    const rereadTokens = totals.ctxRereadTokens ?? 0;
    const rereadCounts = new Map<string, number>();
    for (const run of rereads) {
      for (const path of toStringArray(run.ctxRereadPaths)) {
        rereadCounts.set(path, (rereadCounts.get(path) ?? 0) + 1);
      }
    }
    const gross = savingRatio(baselineTokens, deliveredTokens);
    const net = savingRatio(baselineTokens, deliveredTokens + rereadTokens);
    return {
      windowDays: ACCOUNTING_DAYS,
      runs,
      runsWithPack: withPack._count._all,
      controlRuns,
      baselineTokens,
      deliveredTokens,
      rereadTokens,
      grossSaving: gross === null ? null : round(gross, 4),
      netSaving: net === null ? null : round(net, 4),
      runsWithRereads,
      rereadFiles: totals.ctxRereadFiles ?? 0,
      readFiles: totals.ctxReadFiles ?? 0,
      missedFiles: totals.ctxMissedFiles ?? 0,
      expansions: totals.ctxExpansions ?? 0,
      topRereads: [...rereadCounts.entries()]
        .sort(
          ([leftPath, left], [rightPath, right]) =>
            right - left || leftPath.localeCompare(rightPath),
        )
        .slice(0, TOP_REREADS)
        .map(([relPath, count]) => ({ relPath, runs: count })),
    };
  }

  private async signatureUse(now: Date) {
    const result = await this.deps.prisma.agentRun.aggregate({
      where: {
        startedAt: { gte: new Date(now.getTime() - ACCOUNTING_DAYS * DAY_MS) },
        ctxSignatureTokens: { not: null },
      },
      _sum: { ctxSignatureTokens: true },
      _count: { _all: true },
    });
    return {
      runs: result._count._all,
      tokens: result._sum.ctxSignatureTokens ?? 0,
      windowDays: ACCOUNTING_DAYS,
    };
  }

  private async memoryUse(now: Date) {
    const since = new Date(now.getTime() - ACCOUNTING_DAYS * DAY_MS);
    const [rows, experiment] = await Promise.all([
      this.deps.prisma.$queryRaw<{ sessions: unknown; tokens: unknown }[]>`
        SELECT COUNT(*) AS sessions, COALESCE(SUM(json_extract(memory, '$.tokens')), 0) AS tokens
        FROM Session WHERE memory IS NOT NULL AND startedAt >= ${sqlDate(since)}`,
      this.deps.memory?.experiment() ?? Promise.resolve(EMPTY_MEMORY_EXPERIMENT),
    ]);
    return {
      experiment,
      sessions: Number(rows[0]?.sessions ?? 0),
      tokens: Number(rows[0]?.tokens ?? 0),
      windowDays: ACCOUNTING_DAYS,
    };
  }

  private async experimentSamples(now: Date): Promise<{
    pack: ArmSample[];
    control: ArmSample[];
    variant: ArmSample[];
    since: string | null;
  }> {
    const runs = await experimentRuns(
      this.deps.prisma,
      new Date(now.getTime() - EXPERIMENT_DAYS * DAY_MS),
      MEASURED_STATUSES,
    );
    const pack: ArmSample[] = [];
    const control: ArmSample[] = [];
    const variant: ArmSample[] = [];
    for (const run of runs) {
      if (run.inputTokens === null) continue;
      const sample: ArmSample = {
        completed: run.status === "COMPLETED",
        contextTokens:
          run.inputTokens + (run.cacheCreationTokens ?? 0) + (run.cacheReadTokens ?? 0),
        outputTokens: run.outputTokens ?? 0,
        costUsd: run.costUsd ?? run.logCost,
        turns: run.numTurns,
        readFiles: run.ctxReadFiles ?? 0,
      };
      (run.contextArm === "CONTROL"
        ? control
        : run.contextArm === "TARGET_L2"
          ? variant
          : pack
      ).push(sample);
    }
    const first = runs[0]?.startedAt;
    return { pack, control, variant, since: first ? new Date(first).toISOString() : null };
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
