import { z } from "zod";
import { DOMAINS, MODEL_TIERS, RESET_STRATEGIES, RUN_STATUSES, TASK_KINDS } from "./client";

export {
  DOMAINS,
  EMPTY_USAGE,
  MODEL_TIERS,
  RESET_STRATEGIES,
  RUN_STATUSES,
  TASK_KINDS,
  TERMINAL_RUN_STATUSES,
  addUsage,
  cacheHitRatio,
  contextTokensOf,
  oneOf,
} from "./client";

export const DomainSchema = z.enum(DOMAINS);
export type Domain = z.infer<typeof DomainSchema>;

export const ModelTierSchema = z.enum(MODEL_TIERS);
export type ModelTier = z.infer<typeof ModelTierSchema>;

export const ResetStrategySchema = z.enum(RESET_STRATEGIES);
export type ResetStrategy = z.infer<typeof ResetStrategySchema>;

export const TaskKindSchema = z.enum(TASK_KINDS);
export type TaskKind = z.infer<typeof TaskKindSchema>;

export const TaskStatusSchema = z.enum([
  "DRAFT",
  "PLANNING",
  "AWAITING_APPROVAL",
  "QUEUED",
  "RUNNING",
  "TDD_LOOP",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
  "INTERRUPTED",
]);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

export const RunStatusSchema = z.enum(RUN_STATUSES);
export type RunStatus = z.infer<typeof RunStatusSchema>;

export const RunModeSchema = z.enum(["HEADLESS", "INTERACTIVE"]);
export type RunMode = z.infer<typeof RunModeSchema>;

export const SessionStatusSchema = z.enum(["ACTIVE", "IDLE", "ROTATED", "CLOSED"]);
export type SessionStatus = z.infer<typeof SessionStatusSchema>;

export const SessionEndReasonSchema = z.enum([
  "DOMAIN_SWITCH",
  "CONTEXT_PRESSURE",
  "MODEL_CHANGE",
  "MANUAL_RESET",
  "COMPLETED",
  "ERROR",
  "BUDGET_EXCEEDED",
]);
export type SessionEndReason = z.infer<typeof SessionEndReasonSchema>;

export const PermissionModeSchema = z.enum([
  "acceptEdits",
  "auto",
  "bypassPermissions",
  "manual",
  "dontAsk",
  "plan",
  "default",
]);
export type PermissionMode = z.infer<typeof PermissionModeSchema>;

export const TokenUsageSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheCreationTokens: z.number().int().nonnegative(),
  cacheReadTokens: z.number().int().nonnegative(),
});
export type TokenUsage = z.infer<typeof TokenUsageSchema>;

export const RoutingStrategySchema = z.enum([
  "OVERRIDE",
  "RULE",
  "HEURISTIC",
  "CLASSIFIER",
  "ESCALATION",
  "DEESCALATION",
]);
export type RoutingStrategy = z.infer<typeof RoutingStrategySchema>;
