import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable, Writable } from "node:stream";
import { buildUserInputMessage } from "@onyx/contracts";
import { DEFAULT_ENV_ALLOWLIST, buildChildEnv } from "./environment";
import { DEFAULT_MAX_LINE_LENGTH, LineSplitter } from "./line-splitter";
import { isProcessGroupAlive, signalProcessGroup, type ProcessTracker } from "./process-tools";
import { TextTail } from "./ring-buffer";
import { sandboxCommand, signalSandboxedGroup, type AgentSandbox } from "./sandbox";
import { buildClaudeArgs, type ClaudeBinary, type RunSpec } from "./run-spec";

export type AbortReason =
  "aborted" | "wall_clock_timeout" | "idle_timeout" | "init_timeout" | "shutdown";

export type ExitReason = "completed" | "spawn_error" | AbortReason;

export interface ProcessExit {
  reason: ExitReason;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  sawInit: boolean;
  sawResult: boolean;
  stderrTail: string;
  error: string | null;
}

export type StreamJsonEvent = Record<string, unknown>;

export interface ClaudeProcessHandlers {
  onSpawn?(pid: number): void;
  onEvent(event: StreamJsonEvent): void;
  onInvalidLine?(line: string): void;
  onStderr?(text: string): void;
  onHandlerError?(error: unknown): void;
}

export interface ClaudeProcessOptions {
  binary: ClaudeBinary;
  envAllowlist?: readonly string[];
  baseEnv?: NodeJS.ProcessEnv;
  escalationGraceMs?: number;
  closeGraceMs?: number;
  maxLineLength?: number;
  stderrTailChars?: number;
  sandbox?: AgentSandbox | null;
  tracker?: ProcessTracker | null;
}

const ESCALATION_SIGNALS: readonly NodeJS.Signals[] = ["SIGINT", "SIGTERM", "SIGKILL"];

type StdioChild = ChildProcessByStdio<Writable, Readable, Readable>;

function isRecord(value: unknown): value is StreamJsonEvent {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function notStartedExit(reason: ExitReason, error: string | null = null): ProcessExit {
  return {
    reason,
    exitCode: null,
    signal: null,
    sawInit: false,
    sawResult: false,
    stderrTail: "",
    error,
  };
}

export class ClaudeProcess {
  readonly done: Promise<ProcessExit>;
  private child: StdioChild | null = null;
  private abortReason: AbortReason | null = null;
  private sawInit = false;
  private sawResult = false;
  private exited = false;
  private exitCode: number | null = null;
  private exitSignal: NodeJS.Signals | null = null;
  private readonly stderrTail: TextTail;
  private readonly exitWaiters = new Set<() => void>();
  private readonly timers = new Set<NodeJS.Timeout>();
  private idleTimer: NodeJS.Timeout | null = null;
  private resolveDone: (exit: ProcessExit) => void = () => undefined;

  constructor(
    private readonly spec: RunSpec,
    private readonly handlers: ClaudeProcessHandlers,
    private readonly options: ClaudeProcessOptions,
  ) {
    this.stderrTail = new TextTail(options.stderrTailChars ?? 64 * 1024);
    this.done = new Promise((resolve) => {
      this.resolveDone = resolve;
    });
  }

  get pid(): number | null {
    return this.child?.pid ?? null;
  }

  get hasExited(): boolean {
    return this.exited;
  }

  start(): void {
    if (this.child || this.exited) throw new Error("Claude process already started");
    const env = buildChildEnv(
      this.options.baseEnv ?? process.env,
      this.options.envAllowlist ?? DEFAULT_ENV_ALLOWLIST,
      this.spec.env,
    );

    const launch = sandboxCommand(
      this.options.sandbox,
      this.options.binary.command,
      [...this.options.binary.args, ...buildClaudeArgs(this.spec)],
      env,
    );
    let child: StdioChild;
    try {
      child = spawn(launch.command, launch.args, {
        cwd: this.spec.cwd,
        env: launch.env,
        stdio: ["pipe", "pipe", "pipe"],
        detached: true,
      });
    } catch (error) {
      this.finish("spawn_error", describeError(error));
      return;
    }

    this.child = child;
    child.once("error", (error) => {
      if (child.pid === undefined) this.finish("spawn_error", error.message);
    });
    if (child.pid === undefined) return;
    const pid = child.pid;
    this.track((tracker) => tracker.started(pid, `run:${this.spec.runId}`));

    this.attachStdout(child);
    this.attachStderr(child);
    this.attachLifecycle(child);
    this.armTimers();
    this.notify(() => this.handlers.onSpawn?.(child.pid as number));

    child.stdin.on("error", () => undefined);
    child.stdin.end(`${JSON.stringify(buildUserInputMessage(this.spec.prompt))}\n`);
  }

  async abort(reason: AbortReason = "aborted"): Promise<void> {
    if (this.exited) return;
    this.abortReason ??= reason;
    const pid = this.child?.pid;
    if (pid === undefined) {
      this.finish(reason, null);
      return;
    }
    const graceMs = this.options.escalationGraceMs ?? 5_000;
    for (const signal of ESCALATION_SIGNALS) {
      if (this.exited) return;
      if (this.options.sandbox) await signalSandboxedGroup(this.options.sandbox, pid, signal);
      else signalProcessGroup(pid, signal);
      if (await this.waitForExit(graceMs)) return;
    }
  }

  private attachStdout(child: StdioChild): void {
    const splitter = new LineSplitter(
      {
        onLine: (line) => this.handleLine(line),
        onOverflow: (length) =>
          this.notify(() => this.handlers.onInvalidLine?.(`[discarded line of ${length} chars]`)),
      },
      this.options.maxLineLength ?? DEFAULT_MAX_LINE_LENGTH,
    );
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      this.touch();
      splitter.push(chunk);
    });
    child.stdout.on("end", () => splitter.flush());
  }

  private attachStderr(child: StdioChild): void {
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      this.touch();
      this.stderrTail.append(chunk);
      this.notify(() => this.handlers.onStderr?.(chunk));
    });
  }

  private attachLifecycle(child: StdioChild): void {
    child.once("exit", (code, signal) => {
      this.exitCode = code;
      this.exitSignal = signal;
      this.schedule(() => {
        child.stdout.destroy();
        child.stderr.destroy();
        this.complete();
      }, this.options.closeGraceMs ?? 2_000);
    });
    child.once("close", (code: number | null, signal: NodeJS.Signals | null) => {
      this.exitCode ??= code;
      this.exitSignal ??= signal;
      this.complete();
    });
  }

  private armTimers(): void {
    const { wallClockMs, initMs } = this.spec.timeouts;
    this.schedule(() => void this.abort("wall_clock_timeout"), wallClockMs);
    this.schedule(() => {
      if (!this.sawInit) void this.abort("init_timeout");
    }, initMs);
    this.touch();
  }

  private touch(): void {
    if (this.exited) return;
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.timers.delete(this.idleTimer);
    }
    this.idleTimer = this.schedule(
      () => void this.abort("idle_timeout"),
      this.spec.timeouts.idleMs,
    );
  }

  private schedule(callback: () => void, delayMs: number): NodeJS.Timeout {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      callback();
    }, delayMs);
    timer.unref();
    this.timers.add(timer);
    return timer;
  }

  private handleLine(line: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      this.notify(() => this.handlers.onInvalidLine?.(line));
      return;
    }
    if (!isRecord(parsed)) {
      this.notify(() => this.handlers.onInvalidLine?.(line));
      return;
    }
    if (parsed.type === "system" && parsed.subtype === "init") this.sawInit = true;
    if (parsed.type === "result") this.sawResult = true;
    this.notify(() => this.handlers.onEvent(parsed));
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

  private notify(callback: () => void): void {
    try {
      callback();
    } catch (error) {
      try {
        this.handlers.onHandlerError?.(error);
      } catch {
        return;
      }
    }
  }

  private complete(): void {
    if (this.exited) return;
    const pid = this.child?.pid;
    if (pid !== undefined && isProcessGroupAlive(pid)) {
      if (this.options.sandbox) void signalSandboxedGroup(this.options.sandbox, pid, "SIGKILL");
      else signalProcessGroup(pid, "SIGKILL");
    }
    this.finish("completed", null);
  }

  private finish(reason: ExitReason, error: string | null): void {
    if (this.exited) return;
    this.exited = true;
    const pid = this.child?.pid;
    if (pid !== undefined) this.track((tracker) => tracker.ended(pid));
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    this.resolveDone({
      reason: this.abortReason ?? reason,
      exitCode: this.exitCode,
      signal: this.exitSignal,
      sawInit: this.sawInit,
      sawResult: this.sawResult,
      stderrTail: this.stderrTail.toString(),
      error,
    });
    for (const waiter of this.exitWaiters) waiter();
    this.exitWaiters.clear();
  }

  private waitForExit(timeoutMs: number): Promise<boolean> {
    if (this.exited) return Promise.resolve(true);
    return new Promise((resolve) => {
      const onExit = (): void => {
        clearTimeout(timer);
        resolve(true);
      };
      const timer = setTimeout(() => {
        this.exitWaiters.delete(onExit);
        resolve(this.exited);
      }, timeoutMs);
      this.exitWaiters.add(onExit);
    });
  }
}
