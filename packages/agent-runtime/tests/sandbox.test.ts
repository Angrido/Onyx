import { chmodSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ClaudeProcess,
  PtySession,
  isProcessAlive,
  sandboxCommand,
  type AgentSandbox,
  type StreamJsonEvent,
} from "../src";
import { makeRunSpec, stubBinary, stubEnv, type StubScenario } from "../src/testing";

const AGENT_USER = process.env.ONYX_TEST_AGENT_USER;
const SANDBOX: AgentSandbox = {
  user: AGENT_USER ?? "onyx-agent",
  home: process.env.ONYX_TEST_AGENT_HOME ?? `/home/${AGENT_USER ?? "onyx-agent"}`,
  sudo: "sudo",
};

describe("sandboxed command line", () => {
  it("runs the command through sudo as the agent with a group-writable umask", () => {
    const launch = sandboxCommand(SANDBOX, "/usr/bin/claude", ["-p", "--verbose"], {
      PATH: "/opt/node/bin:/usr/bin",
      HOME: "/home/onyx",
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "core.pager",
      GIT_CONFIG_VALUE_0: "cat",
    });
    expect(launch.command).toBe("sudo");
    expect(launch.args.slice(0, 5)).toEqual(["-n", "-E", "-u", SANDBOX.user, "--"]);
    expect(launch.args.slice(-3)).toEqual(["/usr/bin/claude", "-p", "--verbose"]);
    expect(launch.args[7]).toMatch(/^umask 007;/);
    expect(launch.env).toMatchObject({
      HOME: SANDBOX.home,
      USER: SANDBOX.user,
      ONYX_AGENT_PATH: "/opt/node/bin:/usr/bin",
      GIT_CONFIG_COUNT: "2",
      GIT_CONFIG_KEY_0: "core.pager",
      GIT_CONFIG_KEY_1: "safe.directory",
      GIT_CONFIG_VALUE_1: "*",
    });
  });

  it("leaves the command alone without a sandbox", () => {
    expect(sandboxCommand(null, "claude", ["-p"], { HOME: "/home/onyx" })).toEqual({
      command: "claude",
      args: ["-p"],
      env: { HOME: "/home/onyx" },
    });
  });
});

describe.runIf(AGENT_USER)("agents under their own user", () => {
  let workdir: string;

  beforeEach(() => {
    workdir = mkdtempSync(join(tmpdir(), "onyx-sandbox-"));
    chmodSync(workdir, 0o777);
  });

  afterEach(() => {
    rmSync(workdir, { recursive: true, force: true });
  });

  function launch(scenario: StubScenario, env: Record<string, string> = {}) {
    const events: StreamJsonEvent[] = [];
    const claude = new ClaudeProcess(
      makeRunSpec({
        runId: "run-sandbox",
        cwd: workdir,
        env: stubEnv(scenario, env),
        timeouts: { wallClockMs: 20_000, idleMs: 15_000, initMs: 15_000 },
      }),
      { onEvent: (event) => events.push(event) },
      { binary: stubBinary(), escalationGraceMs: 500, closeGraceMs: 300, sandbox: SANDBOX },
    );
    claude.start();
    return { events, claude };
  }

  async function waitFor(check: () => boolean, ms = 10_000): Promise<void> {
    const end = Date.now() + ms;
    while (!check()) {
      if (Date.now() > end) throw new Error("condition not met");
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  it("runs as the agent user and leaves files the API can change", async () => {
    const secret = join(workdir, "secret.key");
    writeFileSync(secret, "key", { mode: 0o600 });
    const probe = join(workdir, "probe.json");
    writeFileSync(
      probe,
      JSON.stringify([
        { path: secret, action: "read" },
        { path: join(workdir, "created.txt"), action: "write" },
      ]),
      { mode: 0o644 },
    );
    const { events, claude } = launch("probe", { CLAUDE_STUB_PROBE: probe });
    const exit = await claude.done;
    expect(exit.reason).toBe("completed");
    const result = events.find((event) => event.type === "result");
    const report = JSON.parse(String(result?.["result"])) as {
      uid: number;
      home: string;
      results: { ok: boolean; code: string | null }[];
    };
    expect(report.uid).not.toBe(process.getuid?.());
    expect(report.home).toBe(SANDBOX.home);
    expect(report.results.map((entry) => entry.code)).toEqual(["EACCES", null]);
    expect(statSync(join(workdir, "created.txt")).mode & 0o070).toBe(0o060);
  });

  it("stops the agent and its children on abort", async () => {
    const { events, claude } = launch("grandchild");
    await waitFor(() => events.some((event) => event.subtype === "stub_grandchild"));
    const grandchild = Number(events.find((event) => event.subtype === "stub_grandchild")?.["pid"]);
    expect(isProcessAlive(grandchild)).toBe(true);
    await claude.abort();
    await claude.done;
    await waitFor(() => !isProcessAlive(grandchild));
  });

  it("runs terminal commands such as the TDD tests as the agent", async () => {
    let output = "";
    const exited = new Promise<number | null>((resolve) => {
      const session = new PtySession(
        {
          command: "/bin/sh",
          args: ["-c", "id -u; umask"],
          cwd: workdir,
          env: { PATH: process.env.PATH ?? "/usr/bin:/bin" },
          cols: 80,
          rows: 24,
        },
        {
          onData: (data) => {
            output += data;
          },
          onExit: (exit) => resolve(exit.exitCode),
        },
        { sandbox: SANDBOX },
      );
      session.start();
    });
    expect(await exited).toBe(0);
    const [uid, umask] = output.trim().split(/\s+/);
    expect(Number(uid)).not.toBe(process.getuid?.());
    expect(umask).toBe("0007");
  });
});
