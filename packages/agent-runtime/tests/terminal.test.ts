import { describe, expect, it } from "vitest";
import { ClaudeTerminal, buildInteractiveArgs, type TerminalSpec } from "../src";
import { stubBinary } from "../src/testing";

function spec(overrides: Partial<TerminalSpec> = {}): TerminalSpec {
  return {
    terminalId: "t1",
    cwd: process.cwd(),
    model: "claude-sonnet-5-5",
    permissionMode: "acceptEdits",
    session: { mode: "new", sessionId: "6f1c2a3b-0000-4000-8000-000000000001" },
    allowedTools: ["Read"],
    disallowedTools: [],
    settingsFile: null,
    mcpConfigFile: null,
    appendSystemPromptFile: null,
    env: {},
    cols: 100,
    rows: 30,
    ...overrides,
  };
}

function waitForOutput(read: () => string, needle: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (read().includes(needle)) return resolve();
      if (Date.now() > deadline)
        return reject(new Error(`Missing "${needle}" in ${JSON.stringify(read())}`));
      setTimeout(tick, 20);
    };
    tick();
  });
}

describe("interactive arguments", () => {
  it("omits print-mode flags and resumes by id", () => {
    const args = buildInteractiveArgs(
      spec({ session: { mode: "resume", sessionId: "abc" }, settingsFile: "/tmp/s.json" }),
    );
    expect(args).not.toContain("-p");
    expect(args).not.toContain("--output-format");
    expect(args).toEqual([
      "--model",
      "claude-sonnet-5-5",
      "--allowedTools",
      "Read",
      "--permission-mode",
      "acceptEdits",
      "--resume",
      "abc",
      "--settings",
      "/tmp/s.json",
    ]);
  });
});

describe("ClaudeTerminal", () => {
  it("streams output, accepts input and reports the exit", async () => {
    let output = "";
    let exitCode: number | null = null;
    const terminal = new ClaudeTerminal(stubBinary(), spec(), {
      onData: (data) => {
        output += data;
      },
      onExit: (exit) => {
        exitCode = exit.exitCode;
      },
    });
    expect(terminal.start()).toBeGreaterThan(0);
    await waitForOutput(() => output, "session 6f1c2a3b-0000-4000-8000-000000000001");
    terminal.write("hello there\r");
    await waitForOutput(() => output, "Stub reply: hello there");
    terminal.resize(120, 40);
    terminal.write("/exit\r");
    await waitForOutput(() => (exitCode === null ? "" : "exited"), "exited");
    expect(exitCode).toBe(0);
  }, 20_000);

  it("reports the terminal process to the tracker", async () => {
    const seen: string[] = [];
    const terminal = new ClaudeTerminal(
      stubBinary(),
      spec(),
      { onData: () => {}, onExit: () => {} },
      {
        killGraceMs: 200,
        label: "terminal:t1",
        tracker: {
          started: (pid, label) => seen.push(`started ${pid} ${label}`),
          ended: (pid) => seen.push(`ended ${pid}`),
        },
      },
    );
    const pid = terminal.start();
    await terminal.stop();
    expect(seen).toEqual([`started ${pid} terminal:t1`, `ended ${pid}`]);
  }, 20_000);

  it("stops a running terminal", async () => {
    const terminal = new ClaudeTerminal(
      stubBinary(),
      spec(),
      { onData: () => {}, onExit: () => {} },
      {
        killGraceMs: 200,
      },
    );
    terminal.start();
    const exit = await terminal.stop();
    expect(exit).not.toBeNull();
    expect(terminal.exited).toEqual(exit);
  }, 20_000);
});
