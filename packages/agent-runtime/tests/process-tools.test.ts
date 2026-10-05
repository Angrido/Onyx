import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
  isProcessAlive,
  processGroupOf,
  processStartTicks,
  readProcessCommandLine,
  terminateStaleProcess,
} from "../src";

function spawnSleeper(): number {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)", "onyx-sleeper"], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  if (child.pid === undefined) throw new Error("Failed to spawn sleeper");
  return child.pid;
}

async function waitUntilDead(pid: number): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (isProcessAlive(pid)) {
    if (Date.now() > deadline) throw new Error(`Process ${pid} still alive`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe("process tools", () => {
  it("reads the command line of a live process", () => {
    const commandLine = readProcessCommandLine(process.pid);
    expect(commandLine?.length).toBeGreaterThan(0);
    expect(readProcessCommandLine(2 ** 22 + 7)).toBeNull();
  });

  it("reads the start time and the process group of a process", async () => {
    const pid = spawnSleeper();
    const ticks = processStartTicks(pid);
    expect(ticks).toMatch(/^\d+$/);
    expect(processStartTicks(pid)).toBe(ticks);
    expect(processGroupOf(pid)).toBe(pid);
    expect(processGroupOf(process.pid)).not.toBe(pid);
    expect(processStartTicks(2 ** 22 + 7)).toBeNull();
    expect(processGroupOf(2 ** 22 + 7)).toBeNull();
    expect(terminateStaleProcess(pid, "onyx-sleeper")).toBe(true);
    await waitUntilDead(pid);
  });

  it("only terminates processes whose command line matches", async () => {
    const pid = spawnSleeper();
    expect(terminateStaleProcess(pid, "definitely-not-claude")).toBe(false);
    expect(isProcessAlive(pid)).toBe(true);
    expect(terminateStaleProcess(pid, "onyx-sleeper")).toBe(true);
    await waitUntilDead(pid);
  });
});
