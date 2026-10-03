import type { PermissionMode } from "@onyx/contracts";

export type SessionDirective =
  | { mode: "new"; sessionId: string }
  | { mode: "resume"; sessionId: string }
  | { mode: "ephemeral" };

export interface RunTimeouts {
  wallClockMs: number;
  idleMs: number;
  initMs: number;
}

export interface RunSpec {
  runId: string;
  cwd: string;
  prompt: string;
  model: string;
  fallbackModels: readonly string[];
  permissionMode: PermissionMode;
  maxTurns: number;
  session: SessionDirective;
  allowedTools: readonly string[];
  disallowedTools: readonly string[];
  settingsFile: string | null;
  mcpConfigFile: string | null;
  appendSystemPromptFile: string | null;
  includePartialMessages: boolean;
  env: Readonly<Record<string, string>>;
  timeouts: RunTimeouts;
  jsonSchema?: string | null;
  agentsFile?: string | null;
  maxBudgetUsd?: number | null;
}

export interface ClaudeBinary {
  command: string;
  args: readonly string[];
}

function sessionArgs(session: SessionDirective): string[] {
  switch (session.mode) {
    case "new":
      return ["--session-id", session.sessionId];
    case "resume":
      return ["--resume", session.sessionId];
    case "ephemeral":
      return ["--no-session-persistence"];
  }
}

function optionalFlag(flag: string, value: string | null): string[] {
  return value === null ? [] : [flag, value];
}

function listFlag(flag: string, values: readonly string[]): string[] {
  return values.length === 0 ? [] : [flag, ...values];
}

export function buildClaudeArgs(spec: RunSpec): string[] {
  return [
    "-p",
    "--output-format",
    "stream-json",
    "--input-format",
    "stream-json",
    "--verbose",
    "--model",
    spec.model,
    ...optionalFlag(
      "--fallback-model",
      spec.fallbackModels.length > 0 ? spec.fallbackModels.join(",") : null,
    ),
    ...listFlag("--allowedTools", spec.allowedTools),
    ...listFlag("--disallowedTools", spec.disallowedTools),
    "--permission-mode",
    spec.permissionMode,
    "--max-turns",
    String(spec.maxTurns),
    ...sessionArgs(spec.session),
    ...optionalFlag("--settings", spec.settingsFile),
    ...(spec.mcpConfigFile === null
      ? []
      : ["--mcp-config", spec.mcpConfigFile, "--strict-mcp-config"]),
    ...optionalFlag("--append-system-prompt-file", spec.appendSystemPromptFile),
    ...(spec.includePartialMessages ? ["--include-partial-messages"] : []),
    ...optionalFlag("--json-schema", spec.jsonSchema ?? null),
    ...optionalFlag("--agents", spec.agentsFile ?? null),
    ...optionalFlag(
      "--max-budget-usd",
      spec.maxBudgetUsd === undefined || spec.maxBudgetUsd === null
        ? null
        : spec.maxBudgetUsd.toFixed(2),
    ),
  ];
}
