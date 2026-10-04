import type { AgentPool } from "@onyx/agent-runtime";
import pino from "pino";
import { describe, expect, it } from "vitest";
import type { ExecutionResult, RunExecutor, RunRequest } from "../../src/application/run-executor";
import {
  RunScheduler,
  type QueuePolicy,
  type QueuedRun,
} from "../../src/application/run-scheduler";
import type { WsHub } from "../../src/infrastructure/ws-hub";

interface Harness {
  scheduler: RunScheduler;
  started: string[];
  finish: (taskId: string) => Promise<void>;
  clock: { now: number };
  policy: QueuePolicy;
  events: string[];
}

function harness(maxConcurrent: number, policy: Partial<QueuePolicy> = {}): Harness {
  const started: string[] = [];
  const pending = new Map<string, (result: ExecutionResult) => void>();
  const executor = {
    execute: (request: RunRequest, hooks: { onRunCreated: (runId: string) => void }) => {
      started.push(request.taskId);
      hooks.onRunCreated(`run-${request.taskId}`);
      return new Promise<ExecutionResult>((resolve) => pending.set(request.taskId, resolve));
    },
    requestAbort: () => undefined,
  } as unknown as RunExecutor;
  const events: string[] = [];
  const hub = {
    publishSystemRuns: (data: { event: string; taskId: string }) =>
      events.push(`${data.event}:${data.taskId}`),
  } as unknown as WsHub;
  const pool = {
    abort: async () => undefined,
    shutdown: async () => undefined,
  } as unknown as AgentPool;
  const clock = { now: 1_000_000 };
  const current: QueuePolicy = { agingMs: 0, limitOf: () => null, ...policy };
  const scheduler = new RunScheduler({
    executor,
    pool,
    hub,
    logger: pino({ level: "silent" }),
    maxConcurrent,
    policy: () => current,
    now: () => clock.now,
  });
  return {
    scheduler,
    started,
    clock,
    policy: current,
    events,
    finish: async (taskId) => {
      pending.get(taskId)?.({ runId: `run-${taskId}`, status: "COMPLETED", followUp: null });
      pending.delete(taskId);
      await scheduler.settledTask(taskId);
    },
  };
}

function item(
  taskId: string,
  options: { projectId?: string; priority?: number; at?: number; workspace?: string } = {},
): QueuedRun {
  return {
    request: { taskId, modelId: null, agentConfigId: null, prompt: null, newSession: false },
    workspaceId: options.workspace ?? `ws-${taskId}`,
    ...(options.projectId ? { projectId: options.projectId } : {}),
    priority: options.priority ?? 0,
    enqueuedAt: options.at ?? 1_000_000,
  };
}

const order = (scheduler: RunScheduler) =>
  scheduler.queuedRuns().map((entry) => entry.request.taskId);

describe("global run queue", () => {
  it("starts higher priorities first and older runs first on a tie", async () => {
    const { scheduler, started, finish } = harness(1);
    scheduler.enqueue(item("busy"));
    scheduler.enqueue(item("old", { at: 1 }));
    scheduler.enqueue(item("urgent", { priority: 5, at: 3 }));
    scheduler.enqueue(item("new", { at: 2 }));
    expect(order(scheduler)).toEqual(["urgent", "old", "new"]);
    await finish("busy");
    expect(started).toEqual(["busy", "urgent"]);
  });

  it("keeps a project within its limit and gives the free slots to the others", async () => {
    const limits: Record<string, number> = { alpha: 1 };
    const { scheduler, started, finish } = harness(3, {
      limitOf: (projectId) => limits[projectId] ?? null,
    });
    scheduler.enqueue(item("a1", { projectId: "alpha", at: 1 }));
    scheduler.enqueue(item("a2", { projectId: "alpha", at: 2 }));
    scheduler.enqueue(item("a3", { projectId: "alpha", at: 3 }));
    scheduler.enqueue(item("b1", { projectId: "beta", at: 4 }));
    expect(started).toEqual(["a1", "b1"]);
    expect(scheduler.waitingReason("a2")).toBe("PROJECT");
    expect(scheduler.runningIn("alpha")).toBe(1);
    await finish("a1");
    expect(started).toEqual(["a1", "b1", "a2"]);
    expect(scheduler.waitingReason("a3")).toBe("PROJECT");
    limits.alpha = 2;
    scheduler.poke();
    expect(started).toEqual(["a1", "b1", "a2", "a3"]);
  });

  it("names why each queued run waits", () => {
    const { scheduler } = harness(2);
    scheduler.enqueue(item("first", { workspace: "shared" }));
    scheduler.enqueue(item("second", { workspace: "shared" }));
    expect(scheduler.waitingReason("second")).toBe("WORKSPACE");
    scheduler.enqueue(item("third"));
    scheduler.enqueue(item("fourth"));
    expect(scheduler.waitingReason("fourth")).toBe("SLOTS");
    expect(scheduler.waitingReason("third")).toBeNull();
  });

  it("raises long waits by one level per aging step so nothing starves", async () => {
    const { scheduler, started, clock, finish } = harness(1, { agingMs: 60_000 });
    scheduler.enqueue(item("busy"));
    scheduler.enqueue(item("patient", { priority: 0, at: clock.now }));
    clock.now += 3 * 60_000;
    scheduler.enqueue(item("eager", { priority: 2, at: clock.now }));
    expect(order(scheduler)).toEqual(["patient", "eager"]);
    expect(scheduler.effectivePriority(scheduler.queuedRuns()[0] as QueuedRun)).toBe(3);
    await finish("busy");
    expect(started).toEqual(["busy", "patient"]);
  });

  it("moves a run one place, to the top or to the bottom", () => {
    const { scheduler, events } = harness(1);
    scheduler.enqueue(item("busy"));
    scheduler.enqueue(item("a", { at: 1 }));
    scheduler.enqueue(item("b", { at: 2 }));
    scheduler.enqueue(item("c", { at: 3, priority: -1 }));
    scheduler.enqueue(item("d", { at: 4, priority: -1 }));
    expect(order(scheduler)).toEqual(["a", "b", "c", "d"]);
    scheduler.move("d", "up");
    expect(order(scheduler)).toEqual(["a", "b", "d", "c"]);
    scheduler.move("d", "up");
    expect(order(scheduler)).toEqual(["a", "d", "b", "c"]);
    scheduler.move("c", "top");
    expect(order(scheduler)).toEqual(["c", "a", "d", "b"]);
    scheduler.move("c", "down");
    expect(order(scheduler)).toEqual(["a", "c", "d", "b"]);
    scheduler.move("a", "bottom");
    expect(order(scheduler)).toEqual(["c", "d", "b", "a"]);
    expect(scheduler.move("missing", "up")).toBeNull();
    expect(events.filter((event) => event.startsWith("reordered"))).toHaveLength(5);
  });

  it("reports the running runs with their project", () => {
    const { scheduler, clock } = harness(2);
    scheduler.enqueue(item("one", { projectId: "alpha" }));
    expect(scheduler.activeRuns()).toEqual([
      { taskId: "one", projectId: "alpha", runId: "run-one", startedAt: clock.now },
    ]);
  });

  it("groups small tasks of the same workspace when batching is on", async () => {
    const { scheduler, started, finish } = harness(1, { batching: true });
    scheduler.enqueue(item("blocker", { workspace: "other" }));
    const small = (taskId: string, workspace = "w") => ({
      ...item(taskId, { workspace }),
      small: true,
    });
    const first = small("a");
    scheduler.enqueue(first);
    scheduler.enqueue(small("b"));
    scheduler.enqueue(small("c", "elsewhere"));
    scheduler.enqueue(item("big", { workspace: "w" }));
    scheduler.enqueue(small("d"));
    await finish("blocker");
    expect(started).toEqual(["blocker", "a"]);
    expect(first.request.batch).toEqual(["b", "d"]);
    expect(scheduler.queuedRuns().map((entry) => entry.request.taskId)).toEqual(["c", "big"]);
  });

  it("refuses to queue the same task twice", () => {
    const { scheduler } = harness(0);
    scheduler.enqueue(item("twice"));
    expect(() => scheduler.enqueue(item("twice"))).toThrow(/already queued/);
  });
});
