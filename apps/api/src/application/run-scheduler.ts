import type { AgentPool } from "@onyx/agent-runtime";
import type { QueueItemKind, QueueWaitReason, RunStatus } from "@onyx/contracts";
import type { Logger } from "pino";
import type { WsHub } from "../infrastructure/ws-hub";
import { MAX_BATCH } from "../domain/batch";
import type { ExecutionResult, RunExecutor, RunRequest } from "./run-executor";

export interface QueuedRun {
  request: RunRequest;
  workspaceId: string;
  projectId?: string;
  lockKey?: string;
  priority: number;
  canWait?: boolean;
  enqueuedAt: number;
  rank?: number;
  kind?: QueueItemKind;
  small?: boolean;
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

export interface QueuePolicy {
  agingMs: number;
  limitOf: (projectId: string) => number | null;
  batching?: boolean;
}

export type QueueMove = "top" | "up" | "down" | "bottom";

export interface ActiveRun {
  taskId: string;
  projectId: string | null;
  runId: string | null;
  startedAt: number;
}

const NO_POLICY: QueuePolicy = { agingMs: 0, limitOf: () => null };

export interface RunSchedulerDeps {
  executor: RunExecutor;
  pool: AgentPool;
  hub: WsHub;
  logger: Logger;
  maxConcurrent: number;
  admit?: (item: QueuedRun) => Admission;
  reject?: (item: QueuedRun, reason: string) => Promise<void>;
  afterRun?: (taskId: string, outcome: ExecutionResult) => void;
  policy?: () => QueuePolicy;
  now?: () => number;
}

export class RunScheduler {
  private readonly queue: QueuedRun[] = [];
  private readonly busyWorkspaces = new Set<string>();
  private readonly executions = new Map<string, Promise<void>>();
  private readonly runsByTask = new Map<string, string>();
  private readonly projectsByTask = new Map<string, string | null>();
  private readonly pendingAborts = new Set<string>();
  private readonly holds = new Map<string, string>();
  private readonly waiting = new Map<string, QueueWaitReason>();
  private readonly startedAt = new Map<string, number>();
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
    return this.ordered();
  }

  waitingReason(taskId: string): QueueWaitReason | null {
    return this.waiting.get(taskId) ?? null;
  }

  effectivePriority(item: QueuedRun): number {
    return item.priority + this.boost(item);
  }

  activeRuns(): ActiveRun[] {
    return [...this.startedAt].map(([taskId, startedAt]) => ({
      taskId,
      projectId: this.projectsByTask.get(taskId) ?? null,
      runId: this.runsByTask.get(taskId) ?? null,
      startedAt,
    }));
  }

  runningIn(projectId: string): number {
    let count = 0;
    for (const owner of this.projectsByTask.values()) if (owner === projectId) count += 1;
    return count;
  }

  move(taskId: string, to: QueueMove): QueuedRun | null {
    const ordered = this.ordered();
    const index = ordered.findIndex((item) => item.request.taskId === taskId);
    const item = ordered[index];
    if (!item) return null;
    const target =
      to === "top" ? 0 : to === "bottom" ? ordered.length - 1 : to === "up" ? index - 1 : index + 1;
    const anchor = ordered[target];
    if (!anchor || target === index) return item;
    const level = this.effectivePriority(anchor);
    const step = target < index ? -1 : 1;
    const beyond = to === "top" || to === "bottom" ? undefined : ordered[target + step];
    const anchorRank = this.rankOf(anchor);
    item.priority = level - this.boost(item);
    item.rank =
      beyond && beyond !== item && this.effectivePriority(beyond) === level
        ? (anchorRank + this.rankOf(beyond)) / 2
        : anchorRank + step;
    this.announce("reordered", taskId, null, null);
    this.dispatch();
    return item;
  }

  setPriority(taskId: string, priority: number): void {
    for (const item of this.queue)
      if (item.request.taskId === taskId) {
        item.priority = priority;
        delete item.rank;
      }
    this.announce("reordered", taskId, null, null);
    this.dispatch();
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
    this.queue.push(item);
    this.announce("queued", item.request.taskId, null, null);
    this.dispatch();
    const position = this.ordered().indexOf(item);
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
    this.waiting.delete(taskId);
    removed?.onFinished?.(null);
    this.announce("reordered", taskId, null, null);
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
    this.waiting.clear();
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

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  private policy(): QueuePolicy {
    return this.deps.policy?.() ?? NO_POLICY;
  }

  private boost(item: QueuedRun, agingMs = this.policy().agingMs): number {
    if (agingMs <= 0) return 0;
    return Math.max(0, Math.floor((this.now() - item.enqueuedAt) / agingMs));
  }

  private rankOf(item: QueuedRun): number {
    return item.rank ?? item.enqueuedAt;
  }

  private ordered(): QueuedRun[] {
    const { agingMs } = this.policy();
    const level = new Map(
      this.queue.map((item) => [item, item.priority + this.boost(item, agingMs)]),
    );
    return [...this.queue].sort(
      (left, right) =>
        (level.get(right) ?? 0) - (level.get(left) ?? 0) ||
        this.rankOf(left) - this.rankOf(right) ||
        left.enqueuedAt - right.enqueuedAt,
    );
  }

  private dispatch(): void {
    if (this.stopped) return;
    const policy = this.policy();
    const running = new Map<string, number>();
    for (const owner of this.projectsByTask.values())
      if (owner !== null) running.set(owner, (running.get(owner) ?? 0) + 1);
    this.waiting.clear();
    for (const item of this.ordered()) {
      if (!this.queue.includes(item)) continue;
      const taskId = item.request.taskId;
      if (this.inFlight + this.reserved >= this.deps.maxConcurrent) {
        this.waiting.set(taskId, "SLOTS");
        continue;
      }
      const admission = this.deps.admit ? this.deps.admit(item) : null;
      if (admission?.decision === "hold") {
        this.waiting.set(taskId, "QUOTA");
        continue;
      }
      if (admission?.decision === "deny") {
        this.queue.splice(this.queue.indexOf(item), 1);
        void (this.deps.reject?.(item, admission.reason) ?? Promise.resolve())
          .catch((error: unknown) =>
            this.deps.logger.error({ err: error }, "Could not reject a queued run"),
          )
          .finally(() => item.onFinished?.(null));
        continue;
      }
      const holder = this.holds.get(lockOf(item));
      if (
        this.busyWorkspaces.has(lockOf(item)) ||
        (holder !== undefined && holder !== item.holdId)
      ) {
        this.waiting.set(taskId, "WORKSPACE");
        continue;
      }
      const limit = item.projectId ? policy.limitOf(item.projectId) : null;
      if (item.projectId && limit !== null && (running.get(item.projectId) ?? 0) >= limit) {
        this.waiting.set(taskId, "PROJECT");
        continue;
      }
      this.queue.splice(this.queue.indexOf(item), 1);
      if (item.projectId) running.set(item.projectId, (running.get(item.projectId) ?? 0) + 1);
      if (policy.batching) this.gather(item);
      this.start(item);
    }
  }

  private gather(item: QueuedRun): void {
    if (!item.small || (item.kind ?? "TASK") !== "TASK" || item.request.batch || item.onFinished)
      return;
    const mates = this.ordered()
      .filter(
        (other) =>
          other !== item &&
          other.small === true &&
          (other.kind ?? "TASK") === "TASK" &&
          other.onFinished === undefined &&
          other.request.batch === undefined &&
          lockOf(other) === lockOf(item),
      )
      .slice(0, MAX_BATCH - 1);
    if (mates.length === 0) return;
    for (const mate of mates) {
      this.queue.splice(this.queue.indexOf(mate), 1);
      this.waiting.delete(mate.request.taskId);
    }
    item.request.batch = mates.map((mate) => mate.request.taskId);
    this.announce("reordered", item.request.taskId, null, null);
  }

  private start(item: QueuedRun): void {
    const { taskId } = item.request;
    this.inFlight += 1;
    this.busyWorkspaces.add(lockOf(item));
    this.projectsByTask.set(taskId, item.projectId ?? null);
    this.startedAt.set(taskId, this.now());
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
            ...(item.kind ? { kind: item.kind } : {}),
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
        this.startedAt.delete(taskId);
        this.pendingAborts.delete(taskId);
        this.executions.delete(taskId);
        try {
          if (!handedOver) item.onFinished?.(outcome);
          if (outcome) this.deps.afterRun?.(taskId, outcome);
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
    event: "queued" | "started" | "finished" | "reordered",
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
