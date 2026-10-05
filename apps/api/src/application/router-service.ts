import type {
  CreateRoutingRuleRequestSchema,
  UpdateRouterSettingsRequestSchema,
  UpdateRoutingRuleRequestSchema,
} from "@onyx/contracts";
import {
  RouterThresholdsSchema,
  RouterWeightsSchema,
  RoutingFeaturesSchema,
  ScoreComponentsSchema,
  type Domain,
  type ModelTier,
  type RouterPreviewRequestSchema,
  type RouterSettings,
  type RouterSettingsDto,
  type RoutingDecisionDto,
  type RoutingFeatures,
  type RoutingRuleDto,
  type RoutingTelemetry,
  type ScoreComponents,
  type TaskKind,
  type TokenUsage,
  type WorkspaceSource,
} from "@onyx/contracts";
import type { ModelProfile, Prisma, PrismaClient } from "@onyx/db";
import type { Logger } from "pino";
import type { z } from "zod";
import { chooseWorkspace, ZoneMap, type WorkspaceChoice } from "../domain/compartments";
import {
  modelForTier,
  planRouting,
  TIER_ORDER,
  type LastRunView,
  type PreviousRouting,
  type RoutingEscalation,
  type RoutingPlan,
} from "../domain/routing/decide";
import { localizeRationale, RATIONALE } from "../domain/routing/rationale";
import { extractFeatures, type TargetFact } from "../domain/routing/features";
import { parseMatcher, type RuleView } from "../domain/routing/rules";
import { DEFAULT_THRESHOLDS, DEFAULT_WEIGHTS } from "../domain/routing/scoring";
import { badRequest, notFound } from "../errors";
import { interpolate } from "../i18n";
import type { AuxUsage, TaskClassifier } from "../infrastructure/aux-model";
import { completedTaskRuns, type RunTotalRow } from "../infrastructure/run-totals";
import type { IndexService } from "./index-service";
import { toStringArray } from "./mappers";

type CreateRuleInput = z.output<typeof CreateRoutingRuleRequestSchema>;
type UpdateRuleInput = z.output<typeof UpdateRoutingRuleRequestSchema>;
type UpdateSettingsInput = z.output<typeof UpdateRouterSettingsRequestSchema>;
type PreviewInput = z.output<typeof RouterPreviewRequestSchema>;

export interface RouterServiceDeps {
  prisma: PrismaClient;
  indexes: IndexService;
  classifier: TaskClassifier | null;
  logger: Logger;
}

export interface RoutingWorkspace {
  id: string;
  name: string;
  domain: Domain;
}

export interface RoutingRequest {
  projectId: string;
  workspace: RoutingWorkspace | null;
  taskId: string | null;
  kind: TaskKind;
  title: string;
  prompt: string;
  targetPaths: readonly string[];
  override: { modelId: string; source: "run-request" | "task-override" } | null;
  escalation?: RoutingEscalation | null;
  purpose: string;
}

export interface RoutingEvaluation {
  plan: RoutingPlan;
  tier: ModelTier;
  modelId: string;
  features: RoutingFeatures;
  components: ScoreComponents | null;
  rationale: string;
  classifierUsed: boolean;
  previousDecisionId: string | null;
}

const SETTING_KEYS = {
  weights: "router.weights",
  thresholds: "router.thresholds",
  classifierConfidence: "router.classifierConfidence",
  autoEscalate: "router.autoEscalate",
  tierModels: "router.tierModels",
} as const;

const DEFAULT_SETTINGS: RouterSettings = {
  weights: DEFAULT_WEIGHTS,
  thresholds: DEFAULT_THRESHOLDS,
  classifierConfidence: 0.5,
  autoEscalate: true,
};

const MAX_TARGETS = 32;
const FAILED_STATUSES = new Set(["FAILED", "TIMEOUT", "INTERRUPTED"]);
const TIERS: readonly ModelTier[] = ["SCOUT", "BUILDER", "ARCHITECT", "APEX"];

function round(value: number, digits = 6): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function priceUsage(usage: TokenUsage, profile: ModelProfile): number {
  const cacheRead = profile.cacheReadUsdPerMTok ?? profile.inputUsdPerMTok * 0.1;
  const cacheWrite = profile.cacheWriteUsdPerMTok ?? profile.inputUsdPerMTok * 1.25;
  return round(
    (usage.inputTokens * profile.inputUsdPerMTok +
      usage.outputTokens * profile.outputUsdPerMTok +
      usage.cacheReadTokens * cacheRead +
      usage.cacheCreationTokens * cacheWrite) /
      1_000_000,
  );
}

function storedFeatures(value: unknown): {
  features: RoutingFeatures | null;
  components: ScoreComponents | null;
} {
  if (value === null || typeof value !== "object") return { features: null, components: null };
  const record = value as { features?: unknown; components?: unknown };
  const features = RoutingFeaturesSchema.safeParse(record.features);
  const components = ScoreComponentsSchema.safeParse(record.components);
  return {
    features: features.success ? features.data : null,
    components: components.success ? components.data : null,
  };
}

function toRuleDto(row: Prisma.RoutingRuleGetPayload<object>): RoutingRuleDto {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    priority: row.priority,
    matcher: parseMatcher(row.matcher) ?? {},
    targetTier: row.targetTier,
    modelId: row.modelId,
    enabled: row.enabled,
  };
}

const TELEMETRY_DAYS = 90;
const TELEMETRY_CACHE_MS = 60_000;

export class RouterService {
  private readonly telemetryCache = new Map<string, { at: number; value: RoutingTelemetry }>();

  constructor(private readonly deps: RouterServiceDeps) {}

  get classifierAvailable(): boolean {
    return this.deps.classifier !== null;
  }

  async settings(): Promise<RouterSettingsDto> {
    const values = await this.rawSettings();
    const models = await this.deps.prisma.modelProfile.findMany();
    const preferred = await this.tierPreferences();
    const tierModels = Object.fromEntries(
      TIERS.map((tier) => {
        const resolved = modelForTier(tier, models, preferred);
        return [tier, resolved && resolved.tier === tier ? resolved.modelId : null];
      }),
    ) as Record<ModelTier, string | null>;
    return {
      ...values,
      classifierAvailable: this.classifierAvailable,
      classifierModelId: this.deps.classifier?.modelId ?? null,
      tierModels,
    };
  }

  async updateSettings(input: UpdateSettingsInput, actor: string): Promise<RouterSettingsDto> {
    const current = await this.rawSettings();
    const next: RouterSettings = {
      weights: input.weights ?? current.weights,
      thresholds: input.thresholds ?? current.thresholds,
      classifierConfidence: input.classifierConfidence ?? current.classifierConfidence,
      autoEscalate: input.autoEscalate ?? current.autoEscalate,
    };
    if (next.thresholds.builder >= next.thresholds.architect) {
      throw badRequest("The builder threshold must be lower than the architect threshold");
    }
    const { prisma } = this.deps;
    await prisma.$transaction(async (tx) => {
      for (const key of (Object.keys(input) as (keyof RouterSettings)[]).filter(
        (candidate) => input[candidate] !== undefined,
      )) {
        const value = next[key] as Prisma.InputJsonValue;
        await tx.appSetting.upsert({
          where: { key: SETTING_KEYS[key] },
          create: { key: SETTING_KEYS[key], value },
          update: { value },
        });
      }
      await tx.auditLog.create({
        data: { actor, action: "router.settings", target: null, meta: { changes: input } },
      });
    });
    return this.settings();
  }

  async listRules(projectId: string | null): Promise<RoutingRuleDto[]> {
    const rows = await this.deps.prisma.routingRule.findMany({
      where: projectId === null ? {} : { OR: [{ projectId: null }, { projectId }] },
      orderBy: [{ priority: "asc" }, { name: "asc" }],
    });
    return rows.map(toRuleDto);
  }

  async createRule(input: CreateRuleInput, actor: string): Promise<RoutingRuleDto> {
    const { prisma } = this.deps;
    if (input.projectId !== null) {
      const project = await prisma.project.findUnique({ where: { id: input.projectId } });
      if (!project) throw notFound("Project");
    }
    if (input.modelId !== null) await this.assertModel(input.modelId);
    const created = await prisma.routingRule.create({
      data: {
        projectId: input.projectId,
        name: input.name,
        priority: input.priority,
        matcher: input.matcher as Prisma.InputJsonValue,
        targetTier: input.targetTier,
        modelId: input.modelId,
        enabled: input.enabled,
      },
    });
    await this.audit(actor, "router.rule.create", created.id, { name: created.name });
    return toRuleDto(created);
  }

  async updateRule(id: string, input: UpdateRuleInput, actor: string): Promise<RoutingRuleDto> {
    const { prisma } = this.deps;
    const existing = await prisma.routingRule.findUnique({ where: { id } });
    if (!existing) throw notFound("Routing rule");
    if (input.modelId) await this.assertModel(input.modelId);
    const data: Prisma.RoutingRuleUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.priority !== undefined) data.priority = input.priority;
    if (input.matcher !== undefined) data.matcher = input.matcher as Prisma.InputJsonValue;
    if (input.targetTier !== undefined) data.targetTier = input.targetTier;
    if (input.modelId !== undefined) data.modelId = input.modelId;
    if (input.enabled !== undefined) data.enabled = input.enabled;
    const updated = await prisma.routingRule.update({ where: { id }, data });
    await this.audit(actor, "router.rule.update", id, { changes: input });
    return toRuleDto(updated);
  }

  async deleteRule(id: string, actor: string): Promise<void> {
    const existing = await this.deps.prisma.routingRule.findUnique({ where: { id } });
    if (!existing) throw notFound("Routing rule");
    await this.deps.prisma.routingRule.delete({ where: { id } });
    await this.audit(actor, "router.rule.delete", id, { name: existing.name });
  }

  async decisions(projectId: string | null, limit: number): Promise<RoutingDecisionDto[]> {
    const rows = await this.deps.prisma.routingDecision.findMany({
      where: projectId === null ? {} : { task: { projectId } },
      include: { task: { select: { title: true } }, rule: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    return rows.map((row) => ({
      id: row.id,
      taskId: row.taskId,
      taskTitle: row.task.title,
      strategy: row.strategy,
      tier: row.tier,
      modelId: row.modelId,
      rationale: localizeRationale(row.rationale),
      score: row.score,
      confidence: row.confidence,
      ruleId: row.ruleId,
      ruleName: row.rule?.name ?? null,
      ...storedFeatures(row.features),
      createdAt: row.createdAt.toISOString(),
    }));
  }

  async preview(input: PreviewInput): Promise<{
    evaluation: RoutingEvaluation;
    workspace: RoutingWorkspace | null;
    inferred: boolean;
    source: WorkspaceSource | null;
  }> {
    const { prisma } = this.deps;
    const project = await prisma.project.findUnique({
      where: { id: input.projectId },
      include: { workspaces: { orderBy: { position: "asc" } } },
    });
    if (!project) throw notFound("Project");
    let workspace = input.workspaceId
      ? (project.workspaces.find((candidate) => candidate.id === input.workspaceId) ?? null)
      : null;
    if (input.workspaceId && !workspace)
      throw badRequest("Workspace does not belong to the project");
    let inferred = false;
    let source: WorkspaceSource | null = workspace ? "chosen" : null;
    if (!workspace) {
      const resolved = await this.resolveWorkspace(
        input.projectId,
        input.targetPaths,
        `${input.title}\n${input.prompt}`,
        input.kind,
      );
      workspace =
        project.workspaces.find((candidate) => candidate.id === resolved?.workspaceId) ?? null;
      inferred = workspace !== null;
      source = workspace ? (resolved?.source ?? null) : null;
    }
    const target = workspace
      ? { id: workspace.id, name: workspace.name, domain: workspace.domain }
      : null;
    const evaluation = await this.evaluate({
      projectId: input.projectId,
      workspace: target,
      taskId: null,
      kind: input.kind,
      title: input.title,
      prompt: input.prompt,
      targetPaths: input.targetPaths,
      override: null,
      purpose: "router.preview",
    });
    return { evaluation, workspace: target, inferred, source };
  }

  async resolveWorkspace(
    projectId: string,
    targetPaths: readonly string[],
    prompt: string,
    kind: TaskKind | null = null,
  ): Promise<WorkspaceChoice | null> {
    const workspaces = await this.deps.prisma.workspace.findMany({
      where: { projectId },
      orderBy: { position: "asc" },
    });
    const zones = new ZoneMap(
      workspaces.map((workspace) => ({
        id: workspace.id,
        name: workspace.name,
        domain: workspace.domain,
        pathGlobs: toStringArray(workspace.pathGlobs),
      })),
    );
    const targets = await this.targetPaths(projectId, targetPaths, prompt);
    return chooseWorkspace({ workspaces, inference: zones.infer(targets), text: prompt, kind });
  }

  async inferWorkspace(
    projectId: string,
    targetPaths: readonly string[],
    prompt: string,
    kind: TaskKind | null = null,
  ): Promise<string | null> {
    return (await this.resolveWorkspace(projectId, targetPaths, prompt, kind))?.workspaceId ?? null;
  }

  async evaluate(request: RoutingRequest): Promise<RoutingEvaluation> {
    const { prisma, logger, classifier } = this.deps;
    const [settings, preferred, models, ruleRows, workspaces] = await Promise.all([
      this.rawSettings(),
      this.tierPreferences(),
      prisma.modelProfile.findMany(),
      prisma.routingRule.findMany({
        where: { enabled: true, OR: [{ projectId: null }, { projectId: request.projectId }] },
      }),
      prisma.workspace.findMany({
        where: { projectId: request.projectId },
        orderBy: { position: "asc" },
      }),
    ]);
    const zones = new ZoneMap(
      workspaces.map((workspace) => ({
        id: workspace.id,
        name: workspace.name,
        domain: workspace.domain,
        pathGlobs: toStringArray(workspace.pathGlobs),
      })),
    );
    const context = await this.deps.indexes.context(request.projectId);
    const paths = await this.targetPaths(request.projectId, request.targetPaths, request.prompt);
    const targets: TargetFact[] = paths.map((path) => {
      const facts = context?.fileFacts(path) ?? null;
      return {
        path,
        domain: zones.zoneOf(path)?.domain ?? null,
        blastRadius: facts?.blastRadius ?? null,
        rawTokens: facts?.rawTokens ?? 0,
      };
    });
    const history = request.taskId ? await this.history(request.taskId) : null;
    const features = extractFeatures({
      kind: request.kind,
      title: request.title,
      prompt: request.prompt,
      workspaceDomain: request.workspace?.domain ?? null,
      targets,
      priorFailures: history?.priorFailures ?? 0,
    });
    const rules: RuleView[] = ruleRows.flatMap((row) => {
      const matcher = parseMatcher(row.matcher);
      return matcher
        ? [
            {
              id: row.id,
              name: row.name,
              priority: row.priority,
              projectId: row.projectId,
              matcher,
              targetTier: row.targetTier,
              modelId: row.modelId,
            },
          ]
        : [];
    });
    const overrideProfile = request.override
      ? models.find((model) => model.id === request.override?.modelId)
      : undefined;
    let plan = planRouting({
      features,
      text: `${request.title}\n${request.prompt}`,
      override:
        request.override && overrideProfile
          ? { ...request.override, tier: overrideProfile.tier }
          : null,
      rules,
      weights: settings.weights,
      thresholds: settings.thresholds,
      classifierConfidence: settings.classifierConfidence,
      previous: history?.previous ?? null,
      lastRun: history?.lastRun ?? null,
      escalation: request.escalation ?? null,
    });

    let classifierUsed = false;
    if (plan.classify && classifier) {
      try {
        const verdict = await classifier.classify({
          title: request.title,
          prompt: request.prompt,
          kind: request.kind,
          features,
        });
        classifierUsed = true;
        await this.recordAux(verdict.usage, request.purpose, models);
        plan = {
          ...plan,
          strategy: "CLASSIFIER",
          tier: verdict.tier,
          modelId: null,
          classify: false,
          rationale: interpolate(RATIONALE.classifier, {
            model: classifier.modelId,
            verdict: verdict.rationale,
            heuristic: plan.rationale,
          }),
        };
      } catch (error) {
        logger.warn({ err: error }, "Routing classifier failed; keeping the heuristic decision");
        plan = {
          ...plan,
          rationale: interpolate(RATIONALE.unavailable, { rationale: plan.rationale }),
        };
      }
    }

    let modelId: string | null = null;
    let tier = plan.tier;
    let rationale = plan.rationale;
    if (plan.modelId !== null) {
      const pinned = models.find((model) => model.id === plan.modelId && model.enabled);
      if (pinned) {
        modelId = pinned.id;
        tier = pinned.tier;
      } else {
        rationale = interpolate(RATIONALE.notEnabled, { rationale, model: plan.modelId });
      }
    }
    if (modelId === null) {
      const resolved = modelForTier(plan.tier, models, preferred);
      if (!resolved) throw badRequest("No enabled model is available for routing");
      modelId = resolved.modelId;
      tier = resolved.tier;
      if (resolved.substituted) {
        rationale = interpolate(RATIONALE.substituted, {
          rationale,
          tier: plan.tier,
          resolved: resolved.tier,
        });
      }
    }
    return {
      plan,
      tier,
      modelId,
      features,
      components: plan.score?.components ?? null,
      rationale,
      classifierUsed,
      previousDecisionId: history?.previousDecisionId ?? null,
    };
  }

  async record(
    tx: Prisma.TransactionClient,
    taskId: string,
    evaluation: RoutingEvaluation,
  ): Promise<string> {
    const previousId =
      evaluation.previousDecisionId &&
      !(await tx.routingDecision.findFirst({
        where: { previousId: evaluation.previousDecisionId },
      }))
        ? evaluation.previousDecisionId
        : null;
    const decision = await tx.routingDecision.create({
      data: {
        taskId,
        ruleId: evaluation.plan.rule?.id ?? null,
        strategy: evaluation.plan.strategy,
        features: {
          features: evaluation.features,
          components: evaluation.components,
        } as unknown as Prisma.InputJsonValue,
        score: evaluation.plan.score?.value ?? null,
        confidence: evaluation.plan.confidence,
        tier: evaluation.tier,
        modelId: evaluation.modelId,
        rationale: evaluation.rationale,
        previousId,
      },
    });
    return decision.id;
  }

  forgetTelemetry(): void {
    this.telemetryCache.clear();
  }

  async telemetry(projectId: string | null): Promise<RoutingTelemetry> {
    const key = projectId ?? "*";
    const cached = this.telemetryCache.get(key);
    if (cached && Date.now() - cached.at < TELEMETRY_CACHE_MS) return cached.value;
    const value = await this.computeTelemetry(projectId);
    this.telemetryCache.set(key, { at: Date.now(), value });
    return value;
  }

  private async computeTelemetry(projectId: string | null): Promise<RoutingTelemetry> {
    const { prisma } = this.deps;
    const since = new Date(Date.now() - TELEMETRY_DAYS * 86_400_000);
    const [models, preferred] = await Promise.all([
      prisma.modelProfile.findMany(),
      this.tierPreferences(),
    ]);
    const reference = modelForTier("ARCHITECT", models, preferred);
    const referenceProfile = reference
      ? (models.find((model) => model.id === reference.modelId) ?? null)
      : null;
    const rows = await completedTaskRuns(prisma, since, projectId);
    const byTier = new Map<
      ModelTier,
      { tasks: number; runs: number; cost: number; counterfactual: number }
    >();
    let cost = 0;
    let counterfactual = 0;
    let completed = 0;
    const settle = (runs: RunTotalRow[]): void => {
      const finalRun = [...runs].reverse().find((run) => run.status === "COMPLETED");
      if (!finalRun) return;
      completed += 1;
      const tier =
        (finalRun.tier as ModelTier | null) ??
        models.find((model) => model.id === finalRun.modelId)?.tier ??
        "BUILDER";
      const entry = byTier.get(tier) ?? { tasks: 0, runs: 0, cost: 0, counterfactual: 0 };
      entry.tasks += 1;
      for (const run of runs) {
        const hasLog = run.inputTokens !== null;
        const runCost = run.costUsd ?? run.logCost ?? 0;
        const runCounterfactual =
          run.counterfactual ??
          (hasLog && referenceProfile
            ? priceUsage(
                {
                  inputTokens: run.inputTokens ?? 0,
                  outputTokens: run.outputTokens ?? 0,
                  cacheCreationTokens: run.cacheCreationTokens ?? 0,
                  cacheReadTokens: run.cacheReadTokens ?? 0,
                },
                referenceProfile,
              )
            : runCost);
        entry.runs += 1;
        entry.cost += runCost;
        entry.counterfactual += runCounterfactual;
        cost += runCost;
        counterfactual += runCounterfactual;
      }
      byTier.set(tier, entry);
    };
    let current: RunTotalRow[] = [];
    for (const row of rows) {
      if (current.length > 0 && current[0]?.taskId !== row.taskId) {
        settle(current);
        current = [];
      }
      current.push(row);
    }
    if (current.length > 0) settle(current);
    const strategies = await prisma.routingDecision.groupBy({
      by: ["strategy"],
      where: { createdAt: { gte: since }, ...(projectId ? { task: { projectId } } : {}) },
      _count: { _all: true },
    });
    return {
      windowDays: TELEMETRY_DAYS,
      referenceModelId: referenceProfile?.id ?? null,
      completedTasks: completed,
      costUsd: round(cost),
      counterfactualUsd: round(counterfactual),
      costPerCompletedTask: completed > 0 ? round(cost / completed) : null,
      counterfactualPerCompletedTask: completed > 0 ? round(counterfactual / completed) : null,
      savingRatio: counterfactual > 0 ? round(1 - cost / counterfactual, 4) : null,
      byTier: [...byTier.entries()]
        .sort(([a], [b]) => TIER_ORDER[a] - TIER_ORDER[b])
        .map(([tier, entry]) => ({
          tier,
          completedTasks: entry.tasks,
          runs: entry.runs,
          costUsd: round(entry.cost),
          costPerCompletedTask: entry.tasks > 0 ? round(entry.cost / entry.tasks) : null,
          counterfactualUsd: round(entry.counterfactual),
        })),
      byStrategy: strategies
        .map((row) => ({ strategy: row.strategy, decisions: row._count._all }))
        .sort((a, b) => b.decisions - a.decisions),
    };
  }

  async profileForTier(tier: ModelTier): Promise<ModelProfile | null> {
    const [models, preferred] = await Promise.all([
      this.deps.prisma.modelProfile.findMany(),
      this.tierPreferences(),
    ]);
    const chosen = modelForTier(tier, models, preferred);
    return chosen ? (models.find((model) => model.id === chosen.modelId) ?? null) : null;
  }

  async referenceProfile(): Promise<ModelProfile | null> {
    const [models, preferred] = await Promise.all([
      this.deps.prisma.modelProfile.findMany(),
      this.tierPreferences(),
    ]);
    const reference = modelForTier("ARCHITECT", models, preferred);
    return reference ? (models.find((model) => model.id === reference.modelId) ?? null) : null;
  }

  async autoEscalate(): Promise<boolean> {
    return (await this.rawSettings()).autoEscalate;
  }

  private async targetPaths(
    projectId: string,
    targetPaths: readonly string[],
    prompt: string,
  ): Promise<string[]> {
    const context = await this.deps.indexes.context(projectId);
    if (!context) {
      return [
        ...new Set(targetPaths.map((path) => path.trim()).filter((path) => path.length > 0)),
      ].slice(0, MAX_TARGETS);
    }
    const { explicit, inferred } = context.resolveTargets(targetPaths, prompt);
    return [...explicit, ...inferred].slice(0, MAX_TARGETS);
  }

  private async history(taskId: string): Promise<{
    previous: PreviousRouting | null;
    previousDecisionId: string | null;
    lastRun: LastRunView | null;
    priorFailures: number;
  }> {
    const { prisma } = this.deps;
    const [decision, runs] = await Promise.all([
      prisma.routingDecision.findFirst({ where: { taskId }, orderBy: { createdAt: "desc" } }),
      prisma.agentRun.findMany({
        where: { taskId, endedAt: { not: null } },
        orderBy: { startedAt: "desc" },
        take: 20,
        select: { status: true, resultSubtype: true },
      }),
    ]);
    let priorFailures = 0;
    for (const run of runs) {
      if (run.status === "COMPLETED") break;
      if (FAILED_STATUSES.has(run.status)) priorFailures += 1;
    }
    const last = runs[0];
    return {
      previous: decision ? { tier: decision.tier, strategy: decision.strategy } : null,
      previousDecisionId: decision?.id ?? null,
      lastRun: last ? { status: last.status, resultSubtype: last.resultSubtype } : null,
      priorFailures,
    };
  }

  private async recordAux(
    usage: AuxUsage,
    purpose: string,
    models: readonly ModelProfile[],
  ): Promise<void> {
    const profile = models.find((model) => model.id === usage.modelId);
    await this.deps.prisma.tokenLog
      .create({
        data: {
          modelId: usage.modelId,
          scope: "AUX",
          purpose,
          ...usage.usage,
          costUsd: profile ? priceUsage(usage.usage, profile) : null,
        },
      })
      .catch((error: unknown) => this.deps.logger.warn({ err: error }, "Aux token log failed"));
  }

  private async rawSettings(): Promise<RouterSettings> {
    const rows = await this.deps.prisma.appSetting.findMany({
      where: { key: { in: Object.values(SETTING_KEYS) } },
    });
    const value = (key: string) => rows.find((row) => row.key === key)?.value;
    const weights = RouterWeightsSchema.safeParse(value(SETTING_KEYS.weights));
    const thresholds = RouterThresholdsSchema.safeParse(value(SETTING_KEYS.thresholds));
    const confidence = value(SETTING_KEYS.classifierConfidence);
    const autoEscalate = value(SETTING_KEYS.autoEscalate);
    return {
      weights: weights.success ? weights.data : DEFAULT_SETTINGS.weights,
      thresholds: thresholds.success ? thresholds.data : DEFAULT_SETTINGS.thresholds,
      classifierConfidence:
        typeof confidence === "number" ? confidence : DEFAULT_SETTINGS.classifierConfidence,
      autoEscalate:
        typeof autoEscalate === "boolean" ? autoEscalate : DEFAULT_SETTINGS.autoEscalate,
    };
  }

  private async tierPreferences(): Promise<Partial<Record<ModelTier, string | null>>> {
    const row = await this.deps.prisma.appSetting.findUnique({
      where: { key: SETTING_KEYS.tierModels },
    });
    const value = row?.value;
    if (value === null || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value).filter(
        (entry): entry is [ModelTier, string] =>
          TIERS.includes(entry[0] as ModelTier) && typeof entry[1] === "string",
      ),
    );
  }

  private async assertModel(modelId: string): Promise<void> {
    const profile = await this.deps.prisma.modelProfile.findUnique({ where: { id: modelId } });
    if (!profile) throw badRequest(`Unknown model ${modelId}`);
  }

  private async audit(actor: string, action: string, target: string, meta: object): Promise<void> {
    await this.deps.prisma.auditLog.create({
      data: { actor, action, target, meta: meta as Prisma.InputJsonValue },
    });
  }
}
