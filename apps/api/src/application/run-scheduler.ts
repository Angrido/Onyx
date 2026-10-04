import type { AgentPool } from "@onyx/agent-runtime";
import type { RunStatus } from "@onyx/contracts";
import type { Logger } from "pino";
import type { WsHub } from "../infrastructure/ws-hub";
import type { ExecutionResult, RunExecutor, RunRequest } from "./run-executor";

export interface QueuedRun {
  request: RunRequest;
  workspaceId: string;
  projectId?: string;
  lockKey?: string;
  priority: number;
  canWait?: boolean;
  enqueuedAt: number;
  holdId?: string;
  onFinished?: (result: ExecutionResult | null) => void;
}

export type SlotReservation =
  { ok: true; release: () => void } | { ok: false; reason: "busy" | "full" | "stopped" };

export function runLockKey(task: {
  id: string;
  workspaceId: string;
  worktreePath: string | null;
}): string {
  return task.worktreePath ? `task:${task.id}` : task.workspaceId;
}

function lockOf(item: QueuedRun): string {
  return item.lockKey ?? item.workspaceId;
}

export type WorkspaceHold =
  { ok: true; id: string; release: () => void } | { ok: false; reason: "busy" | "stopped" };

export type Admission =
  { decision: "go" } | { decision: "hold"; reason: string } | { decision: "deny"; reason: string };

export interface RunSchedulerDeps {
  executor: RunExecutor;
  pool: AgentPool;
  hub: WsHub;
  logger: Logger;
  maxConcurrent: number;
  admit?: (item: QueuedRun) => Admission;
  reject?: (item: QueuedRun, reason: string) => Promise<void>;
  afterRun?: (taskId: string) => void;
}

export class RunScheduler {
  private readonly queue: QueuedRun[] = [];
  private readonly busyWorkspaces = new Set<string>();
  private readonly executions = new Map<string, Promise<void>>();
  private readonly runsByTask = new Map<string, string>();
  private readonly projectsByTask = new Map<string, string | null>();
  private readonly pendingAborts = new Set<string>();
  private readonly holds = new Map<string, string>();
  private nextHoldId = 1;
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

  queuedRuns(): readonly QueuedRun[] {
    return this.queue;
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
    return this.busyWorkspaces.has(workspaceId) || this.holds.has(workspaceId);
  }

  hold(workspaceId: string): WorkspaceHold {
    if (this.stopped) return { ok: false, reason: "stopped" };
    if (this.isWorkspaceBusy(workspaceId)) return { ok: false, reason: "busy" };
    const id = `hold-${this.nextHoldId++}`;
    this.holds.set(workspaceId, id);
    let released = false;
    return {
      ok: true,
      id,
      release: () => {
        if (released) return;
        released = true;
        if (this.holds.get(workspaceId) === id) this.holds.delete(workspaceId);
        this.dispatch();
      },
    };
  }

  runAndWait(item: Omit<QueuedRun, "onFinished">): Promise<ExecutionResult | null> {
    return new Promise((resolve) => {
      this.enqueue({ ...item, onFinished: resolve });
    });
  }

  reserve(workspaceId: string | null): SlotReservation {
    if (this.stopped) return { ok: false, reason: "stopped" };
    if (workspaceId !== null && this.isWorkspaceBusy(workspaceId))
      return { ok: false, reason: "busy" };
    if (this.inFlight + this.reserved >= this.deps.maxConcurrent)
      return { ok: false, reason: "full" };
    this.reserved += 1;
    if (workspaceId !== null) this.busyWorkspaces.add(workspaceId);
    let released = false;
    return {
      ok: true,
      release: () => {
        if (released) return;
        released = true;
        this.reserved -= 1;
        if (workspaceId !== null) this.busyWorkspaces.delete(workspaceId);
        this.dispatch();
      },
    };
  }

  enqueue(item: QueuedRun): number {
    if (this.stopped) throw new Error("Scheduler is stopped");
    if (this.isQueued(item.request.taskId))
      throw new Error(`Task ${item.request.taskId} is already queued`);
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

  setCanWait(taskId: string, canWait: boolean): void {
    for (const item of this.queue) if (item.request.taskId === taskId) item.canWait = canWait;
    this.dispatch();
  }

  removeQueued(taskId: string): boolean {
    const index = this.queue.findIndex((item) => item.request.taskId === taskId);
    if (index === -1) return false;
    const [removed] = this.queue.splice(index, 1);
    removed?.onFinished?.(null);
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
    for (const item of this.queue.splice(0)) item.onFinished?.(null);
    await this.deps.pool.shutdown();
    await Promise.allSettled([...this.executions.values()]);
  }

  async idle(): Promise<void> {
    while (this.executions.size > 0) {
      await Promise.allSettled([...this.executions.values()]);
    }
  }

  poke(): void {
    this.dispatch();
  }

  async abortScope(projectId: string | null): Promise<number> {
    let aborted = 0;
    for (const [taskId, runId] of [...this.runsByTask]) {
      if (projectId !== null && this.projectsByTask.get(taskId) !== projectId) continue;
      if (await this.abortRun(runId)) aborted += 1;
    }
    return aborted;
  }

  private dispatch(): void {
    if (this.stopped) return;
    let index = 0;
    while (index < this.queue.length && this.inFlight + this.reserved < this.deps.maxConcurrent) {
      const item = this.queue[index];
      const admission = item && this.deps.admit ? this.deps.admit(item) : null;
      if (item && admission?.decision === "hold") {
        index += 1;
        continue;
      }
      if (item && admission?.decision === "deny") {
        this.queue.splice(index, 1);
        void (this.deps.reject?.(item, admission.reason) ?? Promise.resolve())
          .catch((error: unknown) =>
            this.deps.logger.error({ err: error }, "Could not reject a queued run"),
          )
          .finally(() => item.onFinished?.(null));
        continue;
      }
      const holder = item ? this.holds.get(lockOf(item)) : undefined;
      if (
        !item ||
        this.busyWorkspaces.has(lockOf(item)) ||
        (holder !== undefined && holder !== item.holdId)
      ) {
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
    this.busyWorkspaces.add(lockOf(item));
    this.projectsByTask.set(taskId, item.projectId ?? null);
    let outcome: ExecutionResult | null = null;
    let handedOver = false;
    const execution = this.deps.executor
      .execute(item.request, {
        onRunCreated: (runId) => {
          this.runsByTask.set(taskId, runId);
          if (this.pendingAborts.delete(taskId)) this.deps.executor.requestAbort(runId);
          this.announce("started", taskId, runId, "SPAWNING");
        },
      })
      .then((result) => {
        outcome = result;
        if (!result) return;
        this.announceFinished(taskId, result.runId, result.status);
        if (result.followUp && !this.stopped) {
          handedOver = item.onFinished !== undefined;
          this.enqueue({
            request: result.followUp,
            workspaceId: item.workspaceId,
            ...(item.projectId ? { projectId: item.projectId } : {}),
            ...(item.lockKey ? { lockKey: item.lockKey } : {}),
            ...(item.onFinished ? { onFinished: item.onFinished } : {}),
            ...(item.canWait ? { canWait: true } : {}),
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
        this.busyWorkspaces.delete(lockOf(item));
        this.runsByTask.delete(taskId);
        this.projectsByTask.delete(taskId);
        this.pendingAborts.delete(taskId);
        this.executions.delete(taskId);
        try {
          if (!handedOver) item.onFinished?.(outcome);
          if (outcome) this.deps.afterRun?.(taskId);
        } catch (error) {
          this.deps.logger.error({ err: error, taskId }, "Run completion listener failed");
        }
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
