export const WS_PROTOCOL_VERSION = 1;

export const channels = {
  system: "system",
  run: (runId: string) => `run:${runId}`,
  task: (taskId: string) => `task:${taskId}`,
  project: (projectId: string) => `project:${projectId}`,
  workspace: (workspaceId: string) => `workspace:${workspaceId}`,
  pty: (terminalId: string) => `pty:${terminalId}`,
  tdd: (loopId: string) => `tdd:${loopId}`,
  orchestration: (orchestrationId: string) => `orchestration:${orchestrationId}`,
} as const;

export function runIdFromChannel(channel: string): string | null {
  return channel.startsWith("run:") ? channel.slice(4) : null;
}

export const DOMAINS = ["FRONTEND", "BACKEND", "DATABASE", "INFRA", "CUSTOM"] as const;
export const MODEL_TIERS = ["SCOUT", "BUILDER", "ARCHITECT", "APEX"] as const;
export const RESET_STRATEGIES = ["HARD", "HANDOFF", "SOFT"] as const;
export const TASK_KINDS = [
  "ARCHITECTURE",
  "FEATURE",
  "REFACTOR",
  "BUGFIX",
  "UI_STYLE",
  "TEST_FIX",
  "DOCS",
  "CHORE",
] as const;
export const TEST_RUNNERS = ["VITEST", "JEST"] as const;
export const CONTEXT_ARMS = ["PACK", "CONTROL"] as const;
export const SAVINGS_EVIDENCE = ["MEASURED", "ESTIMATED"] as const;
export const QUOTA_LEVELS = ["UNKNOWN", "OK", "WARNING", "HOLDING", "LIMITED"] as const;
export const RULE_SAFETY = ["SAFE", "REVIEW"] as const;
export const GRANT_SCOPES = ["TASK", "AGENT", "PROJECT"] as const;
export const QUEUE_WAIT_REASONS = ["SLOTS", "PROJECT", "WORKSPACE", "QUOTA"] as const;
export const QUEUE_ITEM_KINDS = ["TASK", "TDD", "PLAN"] as const;
export const QUEUE_MOVES = ["top", "up", "down", "bottom"] as const;
export const SAVINGS_SOURCES = [
  "context-pack",
  "stable-prefix",
  "pack-reuse",
  "prompt-cache",
  "routing",
  "stack-commands",
  "quota",
] as const;
export const CACHE_LOSSES = [
  "NEW_SESSION",
  "NONE",
  "PREFIX_CHANGED",
  "MODEL_CHANGED",
  "EXPIRED",
  "UNKNOWN",
] as const;
export const SAVINGS_VERDICTS = [
  "CONFIRMED",
  "NOT_PAYING",
  "NO_DIFFERENCE",
  "COLLECTING",
  "ESTIMATE_ONLY",
  "NO_DATA",
] as const;
export const SAVINGS_CHECK_STATES = ["ok", "warn", "fail", "idle"] as const;
export const RUN_STATUSES = [
  "SPAWNING",
  "RUNNING",
  "COMPLETED",
  "FAILED",
  "ABORTED",
  "TIMEOUT",
  "INTERRUPTED",
] as const;
export const TERMINAL_RUN_STATUSES: readonly (typeof RUN_STATUSES)[number][] = [
  "COMPLETED",
  "FAILED",
  "ABORTED",
  "TIMEOUT",
  "INTERRUPTED",
];

export function oneOf<T extends string>(values: readonly T[], value: string): T | null {
  return values.find((entry) => entry === value) ?? null;
}

export interface UsageCounts {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}

export const EMPTY_USAGE: UsageCounts = Object.freeze({
  inputTokens: 0,
  outputTokens: 0,
  cacheCreationTokens: 0,
  cacheReadTokens: 0,
});

export function addUsage(left: UsageCounts, right: UsageCounts): UsageCounts {
  return {
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    cacheCreationTokens: left.cacheCreationTokens + right.cacheCreationTokens,
    cacheReadTokens: left.cacheReadTokens + right.cacheReadTokens,
  };
}

export function contextTokensOf(usage: UsageCounts): number {
  return usage.inputTokens + usage.cacheReadTokens + usage.cacheCreationTokens;
}

export function cacheHitRatio(usage: UsageCounts): number {
  const total = contextTokensOf(usage);
  return total === 0 ? 0 : usage.cacheReadTokens / total;
}
