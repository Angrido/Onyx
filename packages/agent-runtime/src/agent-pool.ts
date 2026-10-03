import {
  ClaudeProcess,
  notStartedExit,
  type AbortReason,
  type ClaudeProcessHandlers,
  type ClaudeProcessOptions,
  type ProcessExit,
} from "./claude-process";
import type { RunSpec } from "./run-spec";
import { Semaphore, SemaphoreCancelledError } from "./semaphore";

export interface AgentPoolOptions extends ClaudeProcessOptions {
  maxConcurrent: number;
}

export interface PoolRunHandlers extends ClaudeProcessHandlers {
  onSlotAcquired?(): void;
}

export class AgentPool {
  private readonly semaphore: Semaphore;
  private readonly active = new Map<string, ClaudeProcess>();
  private readonly pending = new Map<string, AbortController>();
  private closed = false;

  constructor(private readonly options: AgentPoolOptions) {
    this.semaphore = new Semaphore(options.maxConcurrent);
  }

  get activeCount(): number {
    return this.active.size;
  }

  get pendingCount(): number {
    return this.semaphore.pending;
  }

  get capacity(): number {
    return this.semaphore.limit;
  }

  get hasFreeSlot(): boolean {
    return !this.closed && this.semaphore.active + this.semaphore.pending < this.semaphore.limit;
  }

  isTracking(runId: string): boolean {
    return this.active.has(runId) || this.pending.has(runId);
  }

  pidOf(runId: string): number | null {
    return this.active.get(runId)?.pid ?? null;
  }

  async run(spec: RunSpec, handlers: PoolRunHandlers): Promise<ProcessExit> {
    if (this.closed) return notStartedExit("shutdown");
    if (this.isTracking(spec.runId)) throw new Error(`Run ${spec.runId} is already scheduled`);

    const controller = new AbortController();
    this.pending.set(spec.runId, controller);
    let release: () => void;
    try {
      release = await this.semaphore.acquire(controller.signal);
    } catch (error) {
      if (error instanceof SemaphoreCancelledError) {
        const reason = controller.signal.reason === "shutdown" ? "shutdown" : "aborted";
        return notStartedExit(reason);
      }
      throw error;
    } finally {
      this.pending.delete(spec.runId);
    }

    if (controller.signal.aborted) {
      release();
      return notStartedExit(controller.signal.reason === "shutdown" ? "shutdown" : "aborted");
    }

    const claude = new ClaudeProcess(spec, handlers, this.options);
    this.active.set(spec.runId, claude);
    try {
      handlers.onSlotAcquired?.();
      claude.start();
      return await claude.done;
    } finally {
      this.active.delete(spec.runId);
      release();
    }
  }

  async abort(runId: string, reason: AbortReason = "aborted"): Promise<boolean> {
    const waiting = this.pending.get(runId);
    if (waiting) {
      waiting.abort(reason);
      return true;
    }
    const claude = this.active.get(runId);
    if (!claude) return false;
    await claude.abort(reason);
    return true;
  }

  async shutdown(): Promise<void> {
    this.closed = true;
    for (const controller of this.pending.values()) controller.abort("shutdown");
    await Promise.all([...this.active.values()].map((claude) => claude.abort("shutdown")));
  }
}
