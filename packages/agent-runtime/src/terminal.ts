import type { PermissionMode } from "@onyx/contracts";
import { spawn, type IPty } from "node-pty";
import { DEFAULT_ENV_ALLOWLIST, buildChildEnv } from "./environment";
import type { ClaudeBinary, SessionDirective } from "./run-spec";

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

export class ClaudeTerminal {
  private pty: IPty | null = null;
  private exitInfo: TerminalExit | null = null;
  private readonly exitWaiters: Array<(exit: TerminalExit) => void> = [];

  constructor(
    private readonly binary: ClaudeBinary,
    private readonly spec: TerminalSpec,
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
    const pty = spawn(
      this.binary.command,
      [...this.binary.args, ...buildInteractiveArgs(this.spec)],
      {
        name: TERMINAL_ENV.TERM,
        cols: this.spec.cols,
        rows: this.spec.rows,
        cwd: this.spec.cwd,
        env,
      },
    );
    this.pty = pty;
    pty.onData((data) => this.handlers.onData(data));
    pty.onExit(({ exitCode, signal }) => {
      const exit = { exitCode, signal: signal === undefined || signal === 0 ? null : signal };
      this.exitInfo = exit;
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
    pty.kill("SIGTERM");
    const timer = setTimeout(() => {
      if (this.exitInfo === null) pty.kill("SIGKILL");
    }, this.options.killGraceMs ?? DEFAULT_KILL_GRACE_MS);
    const exit = await exited;
    clearTimeout(timer);
    return exit;
  }
}
