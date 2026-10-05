import type { PermissionMode } from "@onyx/contracts";
import { spawn, type IPty } from "node-pty";
import { DEFAULT_ENV_ALLOWLIST, buildChildEnv } from "./environment";
import type { ProcessTracker } from "./process-tools";
import type { ClaudeBinary, SessionDirective } from "./run-spec";
import { sandboxCommand, signalSandboxedGroup, type AgentSandbox } from "./sandbox";

export interface TerminalSpec {
  terminalId: string;
  cwd: string;
  model: string;
  permissionMode: PermissionMode;
  session: Exclude<SessionDirective, { mode: "ephemeral" }>;
  allowedTools: readonly string[];
  disallowedTools: readonly string[];
  settingsFile: string | null;
  mcpConfigFile: string | null;
  appendSystemPromptFile: string | null;
  env: Readonly<Record<string, string>>;
  cols: number;
  rows: number;
}

export interface TerminalExit {
  exitCode: number;
  signal: number | null;
}

export interface TerminalHandlers {
  onData(data: string): void;
  onExit(exit: TerminalExit): void;
}

export interface TerminalOptions {
  killGraceMs?: number;
  sourceEnv?: NodeJS.ProcessEnv;
  sandbox?: AgentSandbox | null;
  tracker?: ProcessTracker | null;
  label?: string;
}

const DEFAULT_KILL_GRACE_MS = 3_000;
const TERMINAL_ENV = { TERM: "xterm-256color", COLORTERM: "truecolor" } as const;

function optionalFlag(flag: string, value: string | null): string[] {
  return value === null ? [] : [flag, value];
}

function listFlag(flag: string, values: readonly string[]): string[] {
  return values.length === 0 ? [] : [flag, ...values];
}

export function buildInteractiveArgs(spec: TerminalSpec): string[] {
  return [
    "--model",
    spec.model,
    ...listFlag("--allowedTools", spec.allowedTools),
    ...listFlag("--disallowedTools", spec.disallowedTools),
    "--permission-mode",
    spec.permissionMode,
    spec.session.mode === "resume" ? "--resume" : "--session-id",
    spec.session.sessionId,
    ...optionalFlag("--settings", spec.settingsFile),
    ...(spec.mcpConfigFile === null
      ? []
      : ["--mcp-config", spec.mcpConfigFile, "--strict-mcp-config"]),
    ...optionalFlag("--append-system-prompt-file", spec.appendSystemPromptFile),
  ];
}

export interface PtyCommand {
  command: string;
  args: readonly string[];
  cwd: string;
  env: Readonly<Record<string, string>>;
  cols: number;
  rows: number;
}

export class PtySession {
  private pty: IPty | null = null;
  private exitInfo: TerminalExit | null = null;
  private readonly exitWaiters: Array<(exit: TerminalExit) => void> = [];

  constructor(
    private readonly spec: PtyCommand,
    private readonly handlers: TerminalHandlers,
    private readonly options: TerminalOptions = {},
  ) {}

  get pid(): number | null {
    return this.pty?.pid ?? null;
  }

  get exited(): TerminalExit | null {
    return this.exitInfo;
  }

  start(): number {
    if (this.pty) return this.pty.pid;
    const env = buildChildEnv(this.options.sourceEnv ?? process.env, DEFAULT_ENV_ALLOWLIST, {
      ...TERMINAL_ENV,
      ...this.spec.env,
    });
    const launch = sandboxCommand(this.options.sandbox, this.spec.command, this.spec.args, env);
    const pty = spawn(launch.command, launch.args, {
      name: TERMINAL_ENV.TERM,
      cols: this.spec.cols,
      rows: this.spec.rows,
      cwd: this.spec.cwd,
      env: launch.env,
    });
    this.pty = pty;
    this.track((tracker) => tracker.started(pty.pid, this.options.label ?? "pty"));
    pty.onData((data) => this.handlers.onData(data));
    pty.onExit(({ exitCode, signal }) => {
      const exit = { exitCode, signal: signal === undefined || signal === 0 ? null : signal };
      this.exitInfo = exit;
      this.track((tracker) => tracker.ended(pty.pid));
      this.handlers.onExit(exit);
      for (const waiter of this.exitWaiters.splice(0)) waiter(exit);
    });
    return pty.pid;
  }

  write(data: string): void {
    if (this.exitInfo === null) this.pty?.write(data);
  }

  resize(cols: number, rows: number): void {
    if (this.exitInfo === null) this.pty?.resize(Math.max(20, cols), Math.max(5, rows));
  }

  async stop(): Promise<TerminalExit | null> {
    const pty = this.pty;
    if (!pty || this.exitInfo) return this.exitInfo;
    const exited = new Promise<TerminalExit>((resolve) => this.exitWaiters.push(resolve));
    this.signal(pty, "SIGTERM");
    const timer = setTimeout(() => {
      if (this.exitInfo === null) this.signal(pty, "SIGKILL");
    }, this.options.killGraceMs ?? DEFAULT_KILL_GRACE_MS);
    const exit = await exited;
    clearTimeout(timer);
    return exit;
  }

  private track(update: (tracker: ProcessTracker) => void): void {
    const tracker = this.options.tracker;
    if (!tracker) return;
    try {
      update(tracker);
    } catch {
      return;
    }
  }

  private signal(pty: IPty, signal: NodeJS.Signals): void {
    if (this.options.sandbox) void signalSandboxedGroup(this.options.sandbox, pty.pid, signal);
    else pty.kill(signal);
  }
}

export class ClaudeTerminal extends PtySession {
  constructor(
    binary: ClaudeBinary,
    spec: TerminalSpec,
    handlers: TerminalHandlers,
    options: TerminalOptions = {},
  ) {
    super(
      {
        command: binary.command,
        args: [...binary.args, ...buildInteractiveArgs(spec)],
        cwd: spec.cwd,
        env: spec.env,
        cols: spec.cols,
        rows: spec.rows,
      },
      handlers,
      options,
    );
  }
}
