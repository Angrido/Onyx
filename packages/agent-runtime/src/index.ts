export { AgentPool } from "./agent-pool";
export type { AgentPoolOptions, PoolRunHandlers } from "./agent-pool";
export { ClaudeProcess, notStartedExit } from "./claude-process";
export type {
  AbortReason,
  ClaudeProcessHandlers,
  ClaudeProcessOptions,
  ExitReason,
  ProcessExit,
  StreamJsonEvent,
} from "./claude-process";
export { detectCliVersion, parseCliVersion } from "./cli-info";
export { DEFAULT_ENV_ALLOWLIST, HEADLESS_ENV_DEFAULTS, buildChildEnv } from "./environment";
export { DEFAULT_MAX_LINE_LENGTH, LineSplitter } from "./line-splitter";
export {
  isProcessAlive,
  isProcessGroupAlive,
  readProcessCommandLine,
  signalProcessGroup,
  terminateStaleProcess,
} from "./process-tools";
export { TextTail } from "./ring-buffer";
export { buildClaudeArgs } from "./run-spec";
export type { ClaudeBinary, RunSpec, RunTimeouts, SessionDirective } from "./run-spec";
export { Semaphore, SemaphoreCancelledError } from "./semaphore";
