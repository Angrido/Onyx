import { z } from "zod";
import { DomainSchema, ModelTierSchema, RoutingStrategySchema, TaskKindSchema } from "../domain";

export const RuleMatcherSchema = z.object({
  taskKinds: z.array(TaskKindSchema).max(8).optional(),
  workspaceDomains: z.array(DomainSchema).max(5).optional(),
  pathGlobs: z.array(z.string().trim().min(1).max(512)).max(32).optional(),
  keywordsAny: z.array(z.string().trim().min(1).max(64)).max(64).optional(),
  maxFilesTouched: z.number().int().min(0).max(10_000).optional(),
  maxBlastRadius: z.number().int().min(0).max(100_000).optional(),
  styleOnly: z.boolean().optional(),
});
export type RuleMatcher = z.infer<typeof RuleMatcherSchema>;

export const RoutingRuleDtoSchema = z.object({
  id: z.string(),
  projectId: z.string().nullable(),
  name: z.string(),
  priority: z.number().int(),
  matcher: RuleMatcherSchema,
  targetTier: ModelTierSchema,
  modelId: z.string().nullable(),
  enabled: z.boolean(),
});
export type RoutingRuleDto = z.infer<typeof RoutingRuleDtoSchema>;

export const CreateRoutingRuleRequestSchema = z.object({
  projectId: z.string().min(1).nullable().default(null),
  name: z.string().trim().min(1).max(64),
  priority: z.number().int().min(0).max(10_000),
  matcher: RuleMatcherSchema,
  targetTier: ModelTierSchema,
  modelId: z.string().min(1).max(128).nullable().default(null),
  enabled: z.boolean().default(true),
});
export type CreateRoutingRuleRequest = z.input<typeof CreateRoutingRuleRequestSchema>;

export const UpdateRoutingRuleRequestSchema = z.object({
  name: z.string().trim().min(1).max(64).optional(),
  priority: z.number().int().min(0).max(10_000).optional(),
  matcher: RuleMatcherSchema.optional(),
  targetTier: ModelTierSchema.optional(),
  modelId: z.string().min(1).max(128).nullable().optional(),
  enabled: z.boolean().optional(),
});
export type UpdateRoutingRuleRequest = z.input<typeof UpdateRoutingRuleRequestSchema>;

export const RoutingRuleListResponseSchema = z.object({ items: z.array(RoutingRuleDtoSchema) });
export type RoutingRuleListResponse = z.infer<typeof RoutingRuleListResponseSchema>;

export const RouterWeightsSchema = z.object({
  blastRadius: z.number().min(0).max(1),
  crossDomain: z.number().min(0).max(1),
  filesTouched: z.number().min(0).max(1),
  archKeywords: z.number().min(0).max(1),
  contextTokens: z.number().min(0).max(1),
  priorFailures: z.number().min(0).max(1),
});
export type RouterWeights = z.infer<typeof RouterWeightsSchema>;

export const RouterThresholdsSchema = z
  .object({
    architect: z.number().min(0).max(1),
    builder: z.number().min(0).max(1),
  })
  .refine((value) => value.builder < value.architect, {
    message: "The builder threshold must be lower than the architect threshold",
  });
export type RouterThresholds = z.infer<typeof RouterThresholdsSchema>;

export const RouterSettingsSchema = z.object({
  weights: RouterWeightsSchema,
  thresholds: RouterThresholdsSchema,
  classifierConfidence: z.number().min(0).max(1),
  autoEscalate: z.boolean(),
});
export type RouterSettings = z.infer<typeof RouterSettingsSchema>;

export const RouterSettingsDtoSchema = RouterSettingsSchema.extend({
  classifierAvailable: z.boolean(),
  classifierModelId: z.string().nullable(),
  tierModels: z.record(ModelTierSchema, z.string().nullable()),
});
export type RouterSettingsDto = z.infer<typeof RouterSettingsDtoSchema>;

export const UpdateRouterSettingsRequestSchema = RouterSettingsSchema.partial();
export type UpdateRouterSettingsRequest = z.input<typeof UpdateRouterSettingsRequestSchema>;

export const RoutingFeaturesSchema = z.object({
  kind: TaskKindSchema,
  workspaceDomain: DomainSchema.nullable(),
  domains: z.array(DomainSchema),
  crossDomain: z.boolean(),
  filesTouched: z.number().int(),
  targets: z.array(z.string()),
  blastRadius: z.number().int(),
  archKeywords: z.array(z.string()),
  styleOnly: z.boolean(),
  contextTokens: z.number().int(),
  priorFailures: z.number().int(),
});
export type RoutingFeatures = z.infer<typeof RoutingFeaturesSchema>;

export const ScoreComponentsSchema = z.object({
  blastRadius: z.number(),
  crossDomain: z.number(),
  filesTouched: z.number(),
  archKeywords: z.number(),
  contextTokens: z.number(),
  priorFailures: z.number(),
});
export type ScoreComponents = z.infer<typeof ScoreComponentsSchema>;

export const RoutingDecisionDtoSchema = z.object({
  id: z.string().nullable(),
  taskId: z.string().nullable(),
  taskTitle: z.string().nullable(),
  strategy: RoutingStrategySchema,
  tier: ModelTierSchema,
  modelId: z.string(),
  rationale: z.string(),
  score: z.number().nullable(),
  confidence: z.number().nullable(),
  ruleId: z.string().nullable(),
  ruleName: z.string().nullable(),
  features: RoutingFeaturesSchema.nullable(),
  components: ScoreComponentsSchema.nullable(),
  createdAt: z.string().nullable(),
});
export type RoutingDecisionDto = z.infer<typeof RoutingDecisionDtoSchema>;

export const RouterPreviewRequestSchema = z.object({
  projectId: z.string().min(1),
  workspaceId: z.string().min(1).nullable().default(null),
  title: z.string().trim().max(200).default(""),
  prompt: z.string().trim().min(1).max(100_000),
  kind: TaskKindSchema.default("FEATURE"),
  targetPaths: z.array(z.string().trim().min(1).max(1024)).max(32).default([]),
});
export type RouterPreviewRequest = z.input<typeof RouterPreviewRequestSchema>;

export const WorkspaceSourceSchema = z.enum(["chosen", "targets", "prompt", "default"]);
export type WorkspaceSource = z.infer<typeof WorkspaceSourceSchema>;

export const RouterPreviewResponseSchema = z.object({
  decision: RoutingDecisionDtoSchema,
  workspaceId: z.string().nullable(),
  workspaceName: z.string().nullable(),
  workspaceInferred: z.boolean(),
  workspaceSource: WorkspaceSourceSchema.nullable(),
  classifierUsed: z.boolean(),
});
export type RouterPreviewResponse = z.infer<typeof RouterPreviewResponseSchema>;

export const RoutingDecisionListQuerySchema = z.object({
  projectId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type RoutingDecisionListQuery = z.input<typeof RoutingDecisionListQuerySchema>;

export const RoutingDecisionListResponseSchema = z.object({
  items: z.array(RoutingDecisionDtoSchema),
});
export type RoutingDecisionListResponse = z.infer<typeof RoutingDecisionListResponseSchema>;

export const TierSpendSchema = z.object({
  tier: ModelTierSchema,
  completedTasks: z.number().int(),
  runs: z.number().int(),
  costUsd: z.number(),
  costPerCompletedTask: z.number().nullable(),
  counterfactualUsd: z.number(),
});
export type TierSpend = z.infer<typeof TierSpendSchema>;

export const RoutingTelemetrySchema = z.object({
  referenceModelId: z.string().nullable(),
  completedTasks: z.number().int(),
  costUsd: z.number(),
  counterfactualUsd: z.number(),
  costPerCompletedTask: z.number().nullable(),
  counterfactualPerCompletedTask: z.number().nullable(),
  savingRatio: z.number().nullable(),
  byTier: z.array(TierSpendSchema),
  byStrategy: z.array(z.object({ strategy: RoutingStrategySchema, decisions: z.number().int() })),
});
export type RoutingTelemetry = z.infer<typeof RoutingTelemetrySchema>;
