import { fileURLToPath } from "node:url";
import type { ClaudeBinary, RunSpec } from "./run-spec";

export const CLAUDE_STUB_PATH = fileURLToPath(new URL("../bin/claude-stub.ts", import.meta.url));
export const SYNTHETIC_FIXTURES_DIR = fileURLToPath(
  new URL("../fixtures/synthetic", import.meta.url),
);

export const STUB_SCENARIOS = [
  "success",
  "quick",
  "error-max-turns",
  "partial",
  "crash",
  "hang",
  "stubborn",
  "grandchild",
  "split-lines",
  "garbage",
  "silent",
] as const;
export type StubScenario = (typeof STUB_SCENARIOS)[number];

export function stubBinary(): ClaudeBinary {
  return { command: process.execPath, args: [CLAUDE_STUB_PATH] };
}

export function stubEnv(
  scenario: StubScenario,
  extra: Record<string, string> = {},
): Record<string, string> {
  return { CLAUDE_STUB_SCENARIO: scenario, CLAUDE_STUB_DELAY_MS: "5", ...extra };
}

export function makeRunSpec(overrides: Partial<RunSpec> & Pick<RunSpec, "runId" | "cwd">): RunSpec {
  return {
    prompt: "Fix the add function",
    model: "claude-sonnet-5-5",
    fallbackModels: [],
    permissionMode: "acceptEdits",
    maxTurns: 10,
    session: { mode: "new", sessionId: "00000000-0000-4000-8000-00000000abcd" },
    allowedTools: [],
    disallowedTools: [],
    settingsFile: null,
    mcpConfigFile: null,
    appendSystemPromptFile: null,
    includePartialMessages: false,
    env: {},
    timeouts: { wallClockMs: 30_000, idleMs: 10_000, initMs: 10_000 },
    ...overrides,
  };
}
