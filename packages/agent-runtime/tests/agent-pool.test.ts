import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AgentPool, type PoolRunHandlers } from "../src";
import { makeRunSpec, stubBinary, stubEnv, type StubScenario } from "../src/testing";

let workdir: string;

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), "onyx-pool-"));
});

afterEach(() => {
  rmSync(workdir, { recursive: true, force: true });
});

function createPool(maxConcurrent: number): AgentPool {
  return new AgentPool({
    maxConcurrent,
    binary: stubBinary(),
    escalationGraceMs: 300,
    closeGraceMs: 300,
  });
}

function spec(runId: string, scenario: StubScenario) {
  return makeRunSpec({ runId, cwd: workdir, env: stubEnv(scenario) });
}

function handlers(overrides: Partial<PoolRunHandlers> = {}): PoolRunHandlers {
  return { onEvent: () => undefined, ...overrides };
}

describe("AgentPool", () => {
  it("never exceeds the configured concurrency", async () => {
    const pool = createPool(1);
    let running = 0;
    let peak = 0;
    const track = (): PoolRunHandlers =>
      handlers({
        onSlotAcquired: () => {
          running += 1;
          peak = Math.max(peak, running);
        },
        onEvent: (event) => {
          if (event.type === "result") running -= 1;
        },
      });
    const exits = await Promise.all([
      pool.run(spec("a", "quick"), track()),
      pool.run(spec("b", "quick"), track()),
      pool.run(spec("c", "quick"), track()),
    ]);
    expect(peak).toBe(1);
    expect(exits.every((exit) => exit.sawResult)).toBe(true);
    expect(pool.activeCount).toBe(0);
  });

  it("cancels a queued run without spawning it", async () => {
    const pool = createPool(1);
    const spawned: string[] = [];
    const first = pool.run(spec("a", "hang"), handlers({ onSpawn: () => spawned.push("a") }));
    const second = pool.run(spec("b", "quick"), handlers({ onSpawn: () => spawned.push("b") }));
    expect(pool.pendingCount).toBe(1);
    expect(pool.hasFreeSlot).toBe(false);
    await expect(pool.abort("b")).resolves.toBe(true);
    await expect(second).resolves.toMatchObject({ reason: "aborted", sawInit: false });
    await pool.abort("a");
    await expect(first).resolves.toMatchObject({ reason: "aborted" });
    expect(spawned).toEqual(["a"]);
  });

  it("rejects duplicate run ids", async () => {
    const pool = createPool(2);
    const running = pool.run(spec("dup", "hang"), handlers());
    await expect(pool.run(spec("dup", "quick"), handlers())).rejects.toThrow(/already scheduled/);
    await pool.abort("dup");
    await running;
  });

  it("aborts everything on shutdown and refuses new runs", async () => {
    const pool = createPool(1);
    const active = pool.run(spec("a", "hang"), handlers());
    const queued = pool.run(spec("b", "quick"), handlers());
    await new Promise((resolve) => setTimeout(resolve, 100));
    await pool.shutdown();
    await expect(active).resolves.toMatchObject({ reason: "shutdown" });
    await expect(queued).resolves.toMatchObject({ reason: "shutdown" });
    await expect(pool.run(spec("c", "quick"), handlers())).resolves.toMatchObject({
      reason: "shutdown",
    });
  });

  it("returns false when aborting unknown runs", async () => {
    await expect(createPool(1).abort("nope")).resolves.toBe(false);
  });
});
