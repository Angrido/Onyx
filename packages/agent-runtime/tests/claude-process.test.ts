import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ClaudeProcess,
  isProcessAlive,
  type ProcessExit,
  type ProcessTracker,
  type StreamJsonEvent,
} from "../src";
import { makeRunSpec, stubBinary, stubEnv, type StubScenario } from "../src/testing";

interface Harness {
  events: StreamJsonEvent[];
  invalid: string[];
  stderr: string[];
  pids: number[];
  claude: ClaudeProcess;
}

let workdir: string;

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), "onyx-runtime-"));
});

afterEach(() => {
  rmSync(workdir, { recursive: true, force: true });
});

function launch(
  scenario: StubScenario,
  options: {
    timeouts?: { wallClockMs?: number; idleMs?: number; initMs?: number };
    env?: Record<string, string>;
    escalationGraceMs?: number;
    baseEnv?: NodeJS.ProcessEnv;
    command?: string;
    tracker?: ProcessTracker;
  } = {},
): Harness {
  const harness: Omit<Harness, "claude"> = { events: [], invalid: [], stderr: [], pids: [] };
  const binary = options.command ? { command: options.command, args: [] } : stubBinary();
  const claude = new ClaudeProcess(
    makeRunSpec({
      runId: "run-1",
      cwd: workdir,
      env: stubEnv(scenario, options.env),
      timeouts: { wallClockMs: 15_000, idleMs: 10_000, initMs: 10_000, ...options.timeouts },
    }),
    {
      onSpawn: (pid) => harness.pids.push(pid),
      onEvent: (event) => harness.events.push(event),
      onInvalidLine: (line) => harness.invalid.push(line),
      onStderr: (text) => harness.stderr.push(text),
    },
    {
      binary,
      escalationGraceMs: options.escalationGraceMs ?? 500,
      closeGraceMs: 300,
      ...(options.baseEnv ? { baseEnv: options.baseEnv } : {}),
      ...(options.tracker ? { tracker: options.tracker } : {}),
    },
  );
  claude.start();
  return { ...harness, claude };
}

async function waitFor(condition: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function types(events: StreamJsonEvent[]): string[] {
  return events.map((event) => String(event.type));
}

describe("ClaudeProcess", () => {
  it("streams a full successful run and delivers the prompt via stdin", async () => {
    const argsFile = join(workdir, "args.json");
    const harness = launch("success", { env: { CLAUDE_STUB_ARGS_FILE: argsFile } });
    const exit = await harness.claude.done;

    expect(exit).toMatchObject<Partial<ProcessExit>>({
      reason: "completed",
      exitCode: 0,
      sawInit: true,
      sawResult: true,
    });
    expect(harness.pids).toHaveLength(1);
    expect(types(harness.events).at(0)).toBe("system");
    expect(types(harness.events).at(-1)).toBe("result");
    expect(JSON.stringify(harness.events)).toContain("Fix the add function");
    const args = JSON.parse(readFileSync(argsFile, "utf8")) as string[];
    expect(args).toContain("--input-format");
    expect(args[args.indexOf("--session-id") + 1]).toBe("00000000-0000-4000-8000-00000000abcd");
  });

  it("reports the process it starts and its end to the tracker", async () => {
    const seen: string[] = [];
    const tracker: ProcessTracker = {
      started: (pid, label) => seen.push(`started ${pid} ${label}`),
      ended: (pid) => seen.push(`ended ${pid}`),
    };
    const harness = launch("quick", { tracker });
    await harness.claude.done;
    const pid = harness.pids[0];
    expect(seen).toEqual([`started ${pid} run:run-1`, `ended ${pid}`]);
  });

  it("keeps running when the tracker fails", async () => {
    const tracker: ProcessTracker = {
      started: () => {
        throw new Error("disk full");
      },
      ended: () => {
        throw new Error("disk full");
      },
    };
    const exit = await launch("quick", { tracker }).claude.done;
    expect(exit.reason).toBe("completed");
  });

  it("reassembles events written in arbitrary chunks", async () => {
    const harness = launch("split-lines");
    await harness.claude.done;
    expect(harness.events).toHaveLength(13);
    expect(harness.invalid).toEqual([]);
  });

  it("reports invalid lines without failing the run", async () => {
    const harness = launch("garbage");
    const exit = await harness.claude.done;
    expect(harness.invalid).toEqual(["this is not json"]);
    expect(exit.sawResult).toBe(true);
  });

  it("captures crashes with exit code and stderr tail", async () => {
    const harness = launch("crash");
    const exit = await harness.claude.done;
    expect(exit).toMatchObject({
      reason: "completed",
      exitCode: 3,
      sawInit: true,
      sawResult: false,
    });
    expect(exit.stderrTail).toContain("simulated crash");
    expect(harness.stderr.join("")).toContain("simulated crash");
  });

  it("aborts a hanging run with SIGINT", async () => {
    const harness = launch("hang");
    await waitFor(() => harness.events.length > 0);
    await harness.claude.abort();
    const exit = await harness.claude.done;
    expect(exit.reason).toBe("aborted");
    expect(exit.signal).toBe("SIGINT");
  });

  it("escalates to SIGKILL when the process ignores softer signals", async () => {
    const harness = launch("stubborn", { escalationGraceMs: 200 });
    await waitFor(() => harness.events.length > 0);
    await harness.claude.abort();
    const exit = await harness.claude.done;
    expect(exit.reason).toBe("aborted");
    expect(exit.signal).toBe("SIGKILL");
  });

  it("kills the whole process group, grandchildren included", async () => {
    const harness = launch("grandchild");
    await waitFor(() => harness.events.some((event) => event.subtype === "stub_grandchild"));
    const marker = harness.events.find((event) => event.subtype === "stub_grandchild");
    const grandchildPid = Number(marker?.pid);
    expect(isProcessAlive(grandchildPid)).toBe(true);
    await harness.claude.abort();
    await harness.claude.done;
    await waitFor(() => !isProcessAlive(grandchildPid));
  });

  it("aborts on idle timeout", async () => {
    const harness = launch("hang", { timeouts: { idleMs: 300 } });
    const exit = await harness.claude.done;
    expect(exit.reason).toBe("idle_timeout");
  });

  it("aborts when the init event never arrives", async () => {
    const harness = launch("silent", { timeouts: { initMs: 300 } });
    const exit = await harness.claude.done;
    expect(exit).toMatchObject({ reason: "init_timeout", sawInit: false });
  });

  it("aborts on wall-clock timeout", async () => {
    const harness = launch("hang", { timeouts: { wallClockMs: 400 } });
    const exit = await harness.claude.done;
    expect(exit.reason).toBe("wall_clock_timeout");
  });

  it("reports spawn errors for missing binaries", async () => {
    const harness = launch("success", { command: join(workdir, "missing-claude") });
    const exit = await harness.claude.done;
    expect(exit.reason).toBe("spawn_error");
    expect(exit.error).toMatch(/ENOENT/);
  });

  it("passes only allowlisted environment variables", async () => {
    const envFile = join(workdir, "env.json");
    const harness = launch("quick", {
      env: { CLAUDE_STUB_ENV_FILE: envFile },
      baseEnv: { ...process.env, ONYX_SECRET_SHOULD_NOT_LEAK: "x" },
    });
    await harness.claude.done;
    const keys = JSON.parse(readFileSync(envFile, "utf8")) as string[];
    expect(keys).toContain("PATH");
    expect(keys).toContain("DISABLE_AUTOUPDATER");
    expect(keys).not.toContain("ONYX_SECRET_SHOULD_NOT_LEAK");
  });
});
