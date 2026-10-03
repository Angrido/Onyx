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
export {
  REQUIRED_COMMANDS,
  REQUIRED_PERMISSION_MODES,
  checkCliCompatibility,
  detectCliVersion,
  parseCliVersion,
  parseHelp,
  type CliCompatibility,
} from "./cli-info";
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
export { ClaudeTerminal, PtySession, buildInteractiveArgs } from "./terminal";
export type {
  PtyCommand,
  TerminalExit,
  TerminalHandlers,
  TerminalOptions,
  TerminalSpec,
} from "./terminal";
