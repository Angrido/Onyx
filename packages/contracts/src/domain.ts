import { z } from "zod";

export const DomainSchema = z.enum(["FRONTEND", "BACKEND", "DATABASE", "INFRA", "CUSTOM"]);
export type Domain = z.infer<typeof DomainSchema>;

export const ModelTierSchema = z.enum(["SCOUT", "BUILDER", "ARCHITECT", "APEX"]);
export type ModelTier = z.infer<typeof ModelTierSchema>;

export const ResetStrategySchema = z.enum(["HARD", "HANDOFF", "SOFT"]);
export type ResetStrategy = z.infer<typeof ResetStrategySchema>;

export const TaskKindSchema = z.enum([
  "ARCHITECTURE",
  "FEATURE",
  "REFACTOR",
  "BUGFIX",
  "UI_STYLE",
  "TEST_FIX",
  "DOCS",
  "CHORE",
]);
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

export const RunStatusSchema = z.enum([
  "SPAWNING",
  "RUNNING",
  "COMPLETED",
  "FAILED",
  "ABORTED",
  "TIMEOUT",
  "INTERRUPTED",
]);
export type RunStatus = z.infer<typeof RunStatusSchema>;

export const TERMINAL_RUN_STATUSES: readonly RunStatus[] = [
  "COMPLETED",
  "FAILED",
  "ABORTED",
  "TIMEOUT",
  "INTERRUPTED",
];

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

export const EMPTY_USAGE: TokenUsage = Object.freeze({
  inputTokens: 0,
  outputTokens: 0,
  cacheCreationTokens: 0,
  cacheReadTokens: 0,
});

export function addUsage(left: TokenUsage, right: TokenUsage): TokenUsage {
  return {
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    cacheCreationTokens: left.cacheCreationTokens + right.cacheCreationTokens,
    cacheReadTokens: left.cacheReadTokens + right.cacheReadTokens,
  };
}

export function contextTokensOf(usage: TokenUsage): number {
  return usage.inputTokens + usage.cacheReadTokens + usage.cacheCreationTokens;
}

export function cacheHitRatio(usage: TokenUsage): number {
  const total = contextTokensOf(usage);
  return total === 0 ? 0 : usage.cacheReadTokens / total;
}
