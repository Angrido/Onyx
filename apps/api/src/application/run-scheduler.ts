import type { AgentPool } from "@onyx/agent-runtime";
import type { RunStatus } from "@onyx/contracts";
import type { Logger } from "pino";
import type { WsHub } from "../infrastructure/ws-hub";
import type { RunExecutor, RunRequest } from "./run-executor";

export interface QueuedRun {
  request: RunRequest;
  workspaceId: string;
  priority: number;
  enqueuedAt: number;
}

export type SlotReservation =
  { ok: true; release: () => void } | { ok: false; reason: "busy" | "full" | "stopped" };

export interface RunSchedulerDeps {
  executor: RunExecutor;
  pool: AgentPool;
  hub: WsHub;
  logger: Logger;
  maxConcurrent: number;
}

export class RunScheduler {
  private readonly queue: QueuedRun[] = [];
  private readonly busyWorkspaces = new Set<string>();
  private readonly executions = new Map<string, Promise<void>>();
  private readonly runsByTask = new Map<string, string>();
  private readonly pendingAborts = new Set<string>();
  private inFlight = 0;
  private reserved = 0;
  private stopped = false;

  constructor(private readonly deps: RunSchedulerDeps) {}

  get queuedCount(): number {
    return this.queue.length;
  }

  get activeCount(): number {
    return this.inFlight;
  }

  isQueued(taskId: string): boolean {
    return this.queue.some((item) => item.request.taskId === taskId);
  }

  activeRunOf(taskId: string): string | null {
    return this.runsByTask.get(taskId) ?? null;
  }

  get reservedCount(): number {
    return this.reserved;
  }

  isWorkspaceBusy(workspaceId: string): boolean {
    return this.busyWorkspaces.has(workspaceId);
  }

  reserve(workspaceId: string): SlotReservation {
    if (this.stopped) return { ok: false, reason: "stopped" };
    if (this.busyWorkspaces.has(workspaceId)) return { ok: false, reason: "busy" };
    if (this.inFlight + this.reserved >= this.deps.maxConcurrent)
      return { ok: false, reason: "full" };
    this.reserved += 1;
    this.busyWorkspaces.add(workspaceId);
    let released = false;
    return {
      ok: true,
      release: () => {
        if (released) return;
        released = true;
        this.reserved -= 1;
        this.busyWorkspaces.delete(workspaceId);
        this.dispatch();
      },
    };
  }

  enqueue(item: QueuedRun): number {
    if (this.stopped) throw new Error("Scheduler is stopped");
    const index = this.queue.findIndex(
      (queued) =>
        queued.priority < item.priority ||
        (queued.priority === item.priority && queued.enqueuedAt > item.enqueuedAt),
    );
    if (index === -1) this.queue.push(item);
    else this.queue.splice(index, 0, item);
    this.announce("queued", item.request.taskId, null, null);
    this.dispatch();
    const position = this.queue.indexOf(item);
    return position === -1 ? 0 : position + 1;
  }

  removeQueued(taskId: string): boolean {
    const index = this.queue.findIndex((item) => item.request.taskId === taskId);
    if (index === -1) return false;
    this.queue.splice(index, 1);
    return true;
  }

  async abortRun(runId: string): Promise<boolean> {
    const isOurs = [...this.runsByTask.values()].includes(runId);
    if (!isOurs) return false;
    this.deps.executor.requestAbort(runId);
    await this.deps.pool.abort(runId);
    return true;
  }

  async abortTask(taskId: string): Promise<boolean> {
    const runId = this.runsByTask.get(taskId);
    if (runId) return this.abortRun(runId);
    if (!this.executions.has(taskId)) return false;
    this.pendingAborts.add(taskId);
    return true;
  }

  async settledTask(taskId: string): Promise<void> {
    await this.executions.get(taskId);
  }

  async settledRun(runId: string): Promise<void> {
    for (const [taskId, activeRunId] of this.runsByTask) {
      if (activeRunId === runId) await this.settledTask(taskId);
    }
  }

  async shutdown(): Promise<void> {
    this.stopped = true;
    this.queue.length = 0;
    await this.deps.pool.shutdown();
    await Promise.allSettled([...this.executions.values()]);
  }

  async idle(): Promise<void> {
    while (this.executions.size > 0) {
      await Promise.allSettled([...this.executions.values()]);
    }
  }

  private dispatch(): void {
    if (this.stopped) return;
    let index = 0;
    while (index < this.queue.length && this.inFlight + this.reserved < this.deps.maxConcurrent) {
      const item = this.queue[index];
      if (!item || this.busyWorkspaces.has(item.workspaceId)) {
        index += 1;
        continue;
      }
      this.queue.splice(index, 1);
      this.start(item);
    }
  }

  private start(item: QueuedRun): void {
    const { taskId } = item.request;
    this.inFlight += 1;
    this.busyWorkspaces.add(item.workspaceId);
    const execution = this.deps.executor
      .execute(item.request, {
        onRunCreated: (runId) => {
          this.runsByTask.set(taskId, runId);
          if (this.pendingAborts.delete(taskId)) this.deps.executor.requestAbort(runId);
          this.announce("started", taskId, runId, "SPAWNING");
        },
      })
      .then((result) => {
        if (!result) return;
        this.announceFinished(taskId, result.runId, result.status);
        if (result.followUp && !this.stopped) {
          this.enqueue({
            request: result.followUp,
            workspaceId: item.workspaceId,
            priority: item.priority,
            enqueuedAt: Date.now(),
          });
        }
      })
      .catch((error: unknown) => {
        this.deps.logger.error({ err: error, taskId }, "Run execution crashed");
      })
      .finally(() => {
        this.inFlight -= 1;
        this.busyWorkspaces.delete(item.workspaceId);
        this.runsByTask.delete(taskId);
        this.pendingAborts.delete(taskId);
        this.executions.delete(taskId);
        this.dispatch();
      });
    this.executions.set(taskId, execution);
  }

  private announceFinished(taskId: string, runId: string, status: RunStatus): void {
    this.announce("finished", taskId, runId, status, this.inFlight - 1);
  }

  private announce(
    event: "queued" | "started" | "finished",
    taskId: string,
    runId: string | null,
    status: RunStatus | null,
    activeRuns = this.inFlight,
  ): void {
    this.deps.hub.publishSystemRuns({
      event,
      taskId,
      runId,
      status,
      activeRuns,
      queuedTasks: this.queue.length,
    });
  }
}
