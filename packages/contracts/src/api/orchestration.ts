import { z } from "zod";
import { QA_VERDICTS, RESOLUTION_STATES } from "../client";
import { ModelTierSchema, TaskKindSchema, TaskStatusSchema } from "../domain";

export const OrchestrationStatusSchema = z.enum([
  "PLANNING",
  "AWAITING_APPROVAL",
  "RUNNING",
  "VERIFYING",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
]);
export type OrchestrationStatus = z.infer<typeof OrchestrationStatusSchema>;

export const NodeStateSchema = z.enum([
  "pending",
  "running",
  "verifying",
  "reviewing",
  "review",
  "merging",
  "merged",
  "conflict",
  "failed",
  "blocked",
  "cancelled",
]);
export type NodeStateName = z.infer<typeof NodeStateSchema>;

export const PlanActivitySchema = z.object({
  turns: z.number().int(),
  toolCalls: z.number().int(),
  lastAction: z.string(),
});
export type PlanActivity = z.infer<typeof PlanActivitySchema>;

export const QaVerdictSchema = z.enum(QA_VERDICTS);
export type QaVerdict = z.infer<typeof QaVerdictSchema>;
export const ResolutionStateSchema = z.enum(RESOLUTION_STATES);
export type ResolutionState = z.infer<typeof ResolutionStateSchema>;

export const QaCriterionSchema = z.object({
  index: z.number().int(),
  text: z.string(),
  met: z.boolean(),
  evidence: z.string(),
});
export type QaCriterion = z.infer<typeof QaCriterionSchema>;

export const QaIssueSchema = z.object({
  file: z.string().nullable(),
  problem: z.string(),
});
export type QaIssue = z.infer<typeof QaIssueSchema>;

export const QaReviewDtoSchema = z.object({
  id: z.string(),
  attempt: z.number().int(),
  verdict: QaVerdictSchema,
  summary: z.string(),
  criteria: z.array(QaCriterionSchema),
  issues: z.array(QaIssueSchema),
  diffTokens: z.number().int(),
  diffTruncated: z.boolean(),
  modelId: z.string(),
  costUsd: z.number().nullable(),
  createdAt: z.string(),
});
export type QaReviewDto = z.infer<typeof QaReviewDtoSchema>;

export const MergeResolutionDtoSchema = z.object({
  id: z.string(),
  state: ResolutionStateSchema,
  files: z.array(z.string()),
  diff: z.string(),
  checks: z.string().nullable(),
  checksPassed: z.boolean().nullable(),
  modelId: z.string(),
  costUsd: z.number().nullable(),
  message: z.string().nullable(),
  createdAt: z.string(),
  decidedAt: z.string().nullable(),
});
export type MergeResolutionDto = z.infer<typeof MergeResolutionDtoSchema>;

export const OrchestrationNodeSchema = z.object({
  taskId: z.string(),
  key: z.string(),
  title: z.string(),
  description: z.string(),
  kind: TaskKindSchema,
  tier: ModelTierSchema.nullable(),
  workspaceId: z.string().nullable(),
  workspaceName: z.string().nullable(),
  dependsOn: z.array(z.string()),
  level: z.number().int(),
  targetPaths: z.array(z.string()),
  acceptance: z.array(z.string()),
  state: NodeStateSchema,
  taskStatus: TaskStatusSchema,
  branch: z.string().nullable(),
  worktreePath: z.string().nullable(),
  mergeCommit: z.string().nullable(),
  mergedAt: z.string().nullable(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  costUsd: z.number(),
  runs: z.number().int(),
  lastModelId: z.string().nullable(),
  tddLoopId: z.string().nullable(),
  message: z.string().nullable(),
  review: QaReviewDtoSchema.nullable(),
  reviews: z.number().int(),
  resolution: MergeResolutionDtoSchema.nullable(),
});
export type OrchestrationNode = z.infer<typeof OrchestrationNodeSchema>;

export const OrchestrationDtoSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  rootTaskId: z.string(),
  status: OrchestrationStatusSchema,
  goal: z.string(),
  summary: z.string().nullable(),
  warnings: z.array(z.string()),
  baseBranch: z.string().nullable(),
  baseCommit: z.string().nullable(),
  workBranch: z.string().nullable(),
  parallelism: z.number().int(),
  verify: z.boolean(),
  qa: z.boolean(),
  resolveConflicts: z.boolean(),
  qaCostUsd: z.number(),
  plannerModelId: z.string().nullable(),
  plannerCostUsd: z.number().nullable(),
  costUsd: z.number(),
  message: z.string().nullable(),
  activity: PlanActivitySchema.nullable(),
  approvalId: z.string().nullable(),
  verifyLoopId: z.string().nullable(),
  createdAt: z.string(),
  approvedAt: z.string().nullable(),
  startedAt: z.string().nullable(),
  endedAt: z.string().nullable(),
  nodes: z.array(OrchestrationNodeSchema),
});
export type OrchestrationDto = z.infer<typeof OrchestrationDtoSchema>;

export const OrchestrationListResponseSchema = z.object({
  items: z.array(OrchestrationDtoSchema),
});
export type OrchestrationListResponse = z.infer<typeof OrchestrationListResponseSchema>;

export const PublishPlanResultSchema = z.object({
  branch: z.string(),
  pushed: z.boolean(),
  pushError: z.string().nullable(),
  compareUrl: z.string().nullable(),
});
export type PublishPlanResult = z.infer<typeof PublishPlanResultSchema>;

export const CreateOrchestrationRequestSchema = z.object({
  goal: z.string().trim().min(10).max(8_000),
  parallelism: z.number().int().min(1).max(4).default(2),
  verify: z.boolean().default(true),
  qa: z.boolean().default(false),
  resolveConflicts: z.boolean().default(false),
  modelId: z.string().min(1).max(128).optional(),
});
export type CreateOrchestrationRequest = z.input<typeof CreateOrchestrationRequestSchema>;

export const ApprovalKindSchema = z.enum([
  "PLAN",
  "MERGE",
  "BUDGET",
  "ESCALATION",
  "PERMISSION",
  "QA",
]);
export type ApprovalKind = z.infer<typeof ApprovalKindSchema>;

export const ApprovalStatusSchema = z.enum(["PENDING", "APPROVED", "REJECTED", "EXPIRED"]);
export type ApprovalStatus = z.infer<typeof ApprovalStatusSchema>;

export const ApprovalDtoSchema = z.object({
  id: z.string(),
  kind: ApprovalKindSchema,
  status: ApprovalStatusSchema,
  title: z.string(),
  detail: z.string().nullable(),
  projectId: z.string().nullable(),
  projectName: z.string().nullable(),
  taskId: z.string().nullable(),
  orchestrationId: z.string().nullable(),
  link: z.string().nullable(),
  files: z.array(z.string()),
  approveLabel: z.string(),
  rejectLabel: z.string(),
  decidedBy: z.string().nullable(),
  note: z.string().nullable(),
  createdAt: z.string(),
  decidedAt: z.string().nullable(),
});
export type ApprovalDto = z.infer<typeof ApprovalDtoSchema>;

export const ApprovalListQuerySchema = z.object({
  status: ApprovalStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type ApprovalListQuery = z.input<typeof ApprovalListQuerySchema>;

export const ApprovalListResponseSchema = z.object({
  items: z.array(ApprovalDtoSchema),
  pending: z.number().int(),
});
export type ApprovalListResponse = z.infer<typeof ApprovalListResponseSchema>;

export const DecideApprovalRequestSchema = z.object({
  note: z.string().trim().max(2_000).optional(),
});
export type DecideApprovalRequest = z.input<typeof DecideApprovalRequestSchema>;

export const BudgetScopeSchema = z.enum(["GLOBAL", "PROJECT"]);
export type BudgetScope = z.infer<typeof BudgetScopeSchema>;

export const BudgetPeriodSchema = z.enum(["DAY", "MONTH", "LIFETIME"]);
export type BudgetPeriod = z.infer<typeof BudgetPeriodSchema>;

export const BudgetLevelSchema = z.enum(["ok", "soft", "hard"]);
export type BudgetLevelName = z.infer<typeof BudgetLevelSchema>;

export const BudgetDtoSchema = z.object({
  id: z.string(),
  scope: BudgetScopeSchema,
  projectId: z.string().nullable(),
  projectName: z.string().nullable(),
  period: BudgetPeriodSchema,
  softUsd: z.number().nullable(),
  hardUsd: z.number(),
  enabled: z.boolean(),
  spentUsd: z.number(),
  level: BudgetLevelSchema,
  softApproved: z.boolean(),
  periodKey: z.string(),
});
export type BudgetDto = z.infer<typeof BudgetDtoSchema>;

export const BudgetListResponseSchema = z.object({ items: z.array(BudgetDtoSchema) });
export type BudgetListResponse = z.infer<typeof BudgetListResponseSchema>;

const BudgetFieldsSchema = z.object({
  softUsd: z.number().positive().max(100_000).nullable(),
  hardUsd: z.number().positive().max(100_000),
});

export const CreateBudgetRequestSchema = BudgetFieldsSchema.extend({
  scope: BudgetScopeSchema,
  projectId: z.string().min(1).nullable().default(null),
  period: BudgetPeriodSchema,
  enabled: z.boolean().default(true),
}).refine((value) => value.softUsd === null || value.softUsd < value.hardUsd, {
  message: "The soft limit must be lower than the hard limit",
  path: ["softUsd"],
});
export type CreateBudgetRequest = z.input<typeof CreateBudgetRequestSchema>;

export const UpdateBudgetRequestSchema = z.object({
  softUsd: z.number().positive().max(100_000).nullable().optional(),
  hardUsd: z.number().positive().max(100_000).optional(),
  period: BudgetPeriodSchema.optional(),
  enabled: z.boolean().optional(),
});
export type UpdateBudgetRequest = z.input<typeof UpdateBudgetRequestSchema>;
