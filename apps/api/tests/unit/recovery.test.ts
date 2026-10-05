import { spawn } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isProcessAlive, processGroupOf, processStartTicks } from "@onyx/agent-runtime";
import { afterEach, describe, expect, it } from "vitest";
import { untilAborted } from "../../src/domain/abortable";
import { worktreeVerdict } from "../../src/domain/orphan-worktrees";
import { pendingRunOf, readPendingRun } from "../../src/domain/pending-run";
import { ProcessLedger, parseProcessRecord } from "../../src/infrastructure/process-ledger";

const directories: string[] = [];
const sleepers: number[] = [];

function scratch(): string {
  const directory = mkdtempSync(join(tmpdir(), "onyx-ledger-"));
  directories.push(directory);
  return directory;
}

function spawnSleeper(): number {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  if (child.pid === undefined) throw new Error("Failed to spawn a sleeper");
  sleepers.push(child.pid);
  return child.pid;
}

async function deadPid(): Promise<number> {
  const child = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
  await new Promise((resolve) => child.once("exit", resolve));
  if (child.pid === undefined) throw new Error("Failed to spawn a short process");
  return child.pid;
}

async function waitUntilDead(pid: number): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (isProcessAlive(pid)) {
    if (Date.now() > deadline) throw new Error(`Process ${pid} is still alive`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

afterEach(() => {
  for (const pid of sleepers.splice(0)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      continue;
    }
  }
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe("pending run requests", () => {
  it("keeps the prompt, model and tier hint of a queued request", () => {
    const stored = pendingRunOf({
      prompt: "Allowed: continue",
      modelId: "claude-opus-5-5",
      agentConfigId: null,
      newSession: true,
      tierHint: { tier: "ARCHITECT", reason: "escalated" },
    });
    expect(readPendingRun(JSON.parse(JSON.stringify(stored)))).toEqual(stored);
  });

  it("ignores malformed values", () => {
    expect(readPendingRun(null)).toBeNull();
    expect(readPendingRun("prompt")).toBeNull();
    expect(readPendingRun([1])).toBeNull();
    expect(
      readPendingRun({ prompt: "", modelId: 3, newSession: "yes", tierHint: { tier: "HUGE" } }),
    ).toEqual({
      prompt: null,
      modelId: null,
      agentConfigId: null,
      newSession: false,
      tierHint: null,
    });
  });
});

describe("leftover worktrees", () => {
  const running = { status: "RUNNING" as const, workBranch: "onyx/plan" };

  it("keeps the worktrees of unfinished nodes and of live runs", () => {
    expect(
      worktreeVerdict({ name: "api", plan: running, nodeState: "pending", inUse: false }),
    ).toBe("keep");
    expect(
      worktreeVerdict({ name: "api", plan: running, nodeState: "conflict", inUse: false }),
    ).toBe("keep");
    expect(
      worktreeVerdict({ name: "_integration", plan: running, nodeState: undefined, inUse: false }),
    ).toBe("keep");
    expect(
      worktreeVerdict({
        name: "api",
        plan: { status: "COMPLETED", workBranch: "onyx/plan" },
        nodeState: "merged",
        inUse: true,
      }),
    ).toBe("keep");
    expect(
      worktreeVerdict({
        name: "api",
        plan: { status: "FAILED", workBranch: "onyx/plan" },
        nodeState: "failed",
        inUse: false,
      }),
    ).toBe("keep");
  });

  it("removes the worktrees of finished or missing owners and temporary ones", () => {
    expect(worktreeVerdict({ name: "api", plan: null, nodeState: undefined, inUse: false })).toBe(
      "remove",
    );
    for (const status of ["COMPLETED", "CANCELLED"] as const)
      expect(
        worktreeVerdict({
          name: "_integration",
          plan: { status, workBranch: "onyx/plan" },
          nodeState: undefined,
          inUse: false,
        }),
      ).toBe("remove");
    expect(
      worktreeVerdict({
        name: "_baseline-0123",
        plan: running,
        nodeState: undefined,
        inUse: false,
      }),
    ).toBe("remove");
    expect(
      worktreeVerdict({ name: "_resolve-api", plan: running, nodeState: undefined, inUse: false }),
    ).toBe("remove");
    expect(
      worktreeVerdict({ name: "gone", plan: running, nodeState: undefined, inUse: false }),
    ).toBe("remove");
    expect(worktreeVerdict({ name: "api", plan: running, nodeState: "merged", inUse: false })).toBe(
      "remove",
    );
  });
});

describe("abortable waits", () => {
  it("resolves with the value, or with null as soon as the signal aborts", async () => {
    const controller = new AbortController();
    expect(await untilAborted(Promise.resolve(3), controller.signal)).toBe(3);
    const never = new Promise<number>(() => undefined);
    const waiting = untilAborted(never, controller.signal);
    controller.abort();
    expect(await waiting).toBeNull();
    expect(await untilAborted(Promise.resolve(4), controller.signal)).toBeNull();
    await expect(
      untilAborted(Promise.reject(new Error("boom")), new AbortController().signal),
    ).rejects.toThrow("boom");
  });
});

describe("process ledger", () => {
  it("rejects malformed records", () => {
    expect(parseProcessRecord("not json")).toBeNull();
    expect(parseProcessRecord(JSON.stringify({ pid: 1 }))).toBeNull();
    expect(
      parseProcessRecord(
        JSON.stringify({
          pid: 1,
          startTicks: "1",
          label: "run:x",
          instance: "a",
          ownerPid: 10,
          sandboxed: false,
        }),
      ),
    ).toBeNull();
  });

  it("records the processes it starts and forgets them when they end", () => {
    const directory = scratch();
    const ledger = new ProcessLedger(directory);
    const pid = spawnSleeper();
    ledger.started(pid, "run:one");
    expect(ledger.records()).toMatchObject([{ pid, label: "run:one", instance: ledger.instance }]);
    ledger.ended(pid);
    expect(ledger.records()).toEqual([]);
  });

  it("stops the processes of a previous Onyx and nothing else", async () => {
    const directory = scratch();
    const orphan = spawnSleeper();
    const reused = spawnSleeper();
    const foreign = spawnSleeper();
    const owner = await deadPid();
    const previous = new ProcessLedger(directory, { instance: "previous", ownerPid: owner });
    previous.started(orphan, "run:orphan");
    previous.started(reused, "terminal:reused");
    writeFileSync(
      join(directory, `${reused}.json`),
      JSON.stringify({
        ...previous.records().find((record) => record.pid === reused),
        startTicks: "1",
      }),
    );
    const alive = new ProcessLedger(directory, { instance: "alive", ownerPid: process.ppid });
    alive.started(foreign, "test:alive");
    writeFileSync(join(directory, "notes.txt"), "not a record");

    expect(processGroupOf(orphan)).toBe(orphan);
    expect(processStartTicks(orphan)).not.toBeNull();
    const current = new ProcessLedger(directory);
    const sweep = await current.sweep();
    expect(sweep.killed.map((record) => record.label)).toEqual(["run:orphan"]);
    expect(sweep.gone).toBe(1);
    expect(sweep.kept).toBe(1);
    await waitUntilDead(orphan);
    expect(isProcessAlive(reused)).toBe(true);
    expect(isProcessAlive(foreign)).toBe(true);
    expect(readdirSync(directory).sort()).toEqual([`${foreign}.json`, "notes.txt"].sort());
  });

  it("treats records of an older instance in the same process as orphans", async () => {
    const directory = scratch();
    const orphan = spawnSleeper();
    new ProcessLedger(directory, { instance: "before-restart" }).started(orphan, "run:old");
    const own = spawnSleeper();
    const current = new ProcessLedger(directory);
    current.started(own, "run:new");
    const sweep = await current.sweep();
    expect(sweep.killed.map((record) => record.pid)).toEqual([orphan]);
    expect(sweep.kept).toBe(1);
    await waitUntilDead(orphan);
    expect(isProcessAlive(own)).toBe(true);
  });
});
