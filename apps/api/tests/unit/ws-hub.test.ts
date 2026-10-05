import type { RunItem, ServerMessage } from "@onyx/contracts";
import { describe, expect, it } from "vitest";
import { WsHub, type StoredRunEvent, type WsConnection } from "../../src/infrastructure/ws-hub";

class FakeConnection implements WsConnection {
  readonly messages: ServerMessage[] = [];
  bufferedAmount = 0;
  closed: number | null = null;

  send(data: string): void {
    this.messages.push(JSON.parse(data) as ServerMessage);
  }

  close(code?: number): void {
    this.closed = code ?? 1000;
  }

  seqs(type: ServerMessage["type"] = "run.event"): number[] {
    return this.messages.flatMap((message) =>
      message.type === type && "seq" in message ? [message.seq] : [],
    );
  }
}

const item: RunItem = { kind: "stderr", text: "x" };

function storedEvents(range: number[]): StoredRunEvent[] {
  return range.map((seq) => ({ seq, ts: new Date(0).toISOString(), items: [item] }));
}

describe("WsHub", () => {
  it("delivers live run events to subscribers", async () => {
    const hub = new WsHub(async () => []);
    const connection = new FakeConnection();
    const subscriber = hub.connect(connection);
    await hub.subscribe(subscriber, ["run:r1"]);
    hub.publishRunEvent("r1", 1, "t", [item]);
    hub.publishRunEvent("r2", 1, "t", [item]);
    expect(connection.messages[0]?.type).toBe("subscribed");
    expect(connection.seqs()).toEqual([1]);
  });

  it("replays from the database when the buffer does not cover the cursor", async () => {
    const calls: Array<[number, number | null]> = [];
    const hub = new WsHub(
      async (_runId, after, before) => {
        calls.push([after, before]);
        return storedEvents(
          [1, 2, 3].filter((seq) => seq > after && (before === null || seq < before)),
        );
      },
      { bufferSize: 2 },
    );
    for (const seq of [1, 2, 3, 4, 5]) hub.publishRunEvent("r1", seq, "t", [item]);
    const connection = new FakeConnection();
    await hub.subscribe(hub.connect(connection), ["run:r1"], { "run:r1": 0 });
    expect(calls).toEqual([[0, 4]]);
    expect(connection.seqs()).toEqual([1, 2, 3, 4, 5]);
  });

  it("queues live events during replay and never duplicates", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const hub = new WsHub(async () => {
      await gate;
      return storedEvents([1, 2]);
    });
    const connection = new FakeConnection();
    const subscribing = hub.subscribe(hub.connect(connection), ["run:r1"], { "run:r1": 0 });
    hub.publishRunEvent("r1", 2, "t", [item]);
    hub.publishRunEvent("r1", 3, "t", [item]);
    expect(connection.seqs()).toEqual([]);
    release();
    await subscribing;
    expect(connection.seqs()).toEqual([1, 2, 3]);
  });

  it("assigns sequence numbers to task and system channels", async () => {
    const hub = new WsHub(async () => []);
    const connection = new FakeConnection();
    await hub.subscribe(hub.connect(connection), ["project:p1", "system"]);
    hub.publishTaskStatus({ taskId: "t1", projectId: "p1", status: "QUEUED", runId: null });
    hub.publishTaskStatus({ taskId: "t1", projectId: "p1", status: "RUNNING", runId: "r1" });
    hub.publishSystemRuns({
      event: "started",
      taskId: "t1",
      runId: "r1",
      status: "SPAWNING",
      activeRuns: 1,
      queuedTasks: 0,
    });
    expect(connection.seqs("task.status")).toEqual([1, 2]);
    expect(connection.seqs("system.runs")).toEqual([1]);
  });

  it("disconnects slow consumers", async () => {
    const hub = new WsHub(async () => [], { maxBufferedBytes: 10 });
    const connection = new FakeConnection();
    const subscriber = hub.connect(connection);
    await hub.subscribe(subscriber, ["run:r1"]);
    connection.bufferedAmount = 11;
    hub.publishRunEvent("r1", 1, "t", [item]);
    expect(connection.closed).toBe(1013);
    expect(hub.connectionCount).toBe(0);
  });

  it("evicts idle channels but keeps the system channel", async () => {
    const hub = new WsHub(async () => [], { maxChannels: 2 });
    hub.publishSystemRuns({
      event: "queued",
      taskId: "t",
      runId: null,
      status: null,
      activeRuns: 0,
      queuedTasks: 1,
    });
    hub.publishRunEvent("a", 1, "t", [item]);
    hub.publishRunEvent("b", 1, "t", [item]);
    const connection = new FakeConnection();
    await hub.subscribe(hub.connect(connection), ["system"], { system: 0 });
    expect(connection.seqs("system.runs")).toEqual([1]);
  });

  it("groups streamed text and sends it before the next event (M22)", async () => {
    const hub = new WsHub(async () => []);
    const connection = new FakeConnection();
    await hub.subscribe(hub.connect(connection), ["run:r1"]);
    hub.publishRunDelta("r1", 0, "Hel");
    hub.publishRunDelta("r1", 0, "lo");
    hub.publishRunEvent("r1", 1, "t", [item]);
    expect(
      connection.messages.map((message) =>
        message.type === "run.delta" ? `delta:${message.data.text}` : message.type,
      ),
    ).toEqual(["subscribed", "delta:Hello", "run.event"]);
  });

  it("bounds the buffer in bytes and forgets it when the run ends (M22)", async () => {
    const calls: number[] = [];
    const hub = new WsHub(
      async (_runId, after, before) => {
        calls.push(after);
        return storedEvents(
          [1, 2, 3].filter((seq) => seq > after && (before === null || seq < before)),
        );
      },
      { bufferBytes: 400 },
    );
    const big: RunItem = { kind: "stderr", text: "x".repeat(300) };
    for (const seq of [1, 2, 3]) hub.publishRunEvent("r1", seq, "t", [big]);
    const first = new FakeConnection();
    await hub.subscribe(hub.connect(first), ["run:r1"], { "run:r1": 0 });
    expect(calls).toEqual([0]);
    expect(first.seqs()).toEqual([1, 2, 3]);
    hub.releaseRun("r1");
    const second = new FakeConnection();
    await hub.subscribe(hub.connect(second), ["run:r1"], { "run:r1": 0 });
    expect(calls).toEqual([0, 0]);
    expect(second.seqs()).toEqual([1, 2, 3]);
  });

  it("drops the listeners of channels nobody watches (M22)", async () => {
    const hub = new WsHub(async () => []);
    const subscriber = hub.connect(new FakeConnection());
    await hub.subscribe(subscriber, ["task:t1"]);
    expect(hub.hasListeners("task:t1")).toBe(true);
    hub.unsubscribe(subscriber, ["task:t1"]);
    expect(hub.hasListeners("task:t1")).toBe(false);
  });
});
