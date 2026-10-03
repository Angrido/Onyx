import { describe, expect, it } from "vitest";
import { buildClaudeArgs } from "../src";
import { makeRunSpec } from "../src/testing";

describe("buildClaudeArgs", () => {
  it("builds headless stream-json arguments for a new session", () => {
    const args = buildClaudeArgs(
      makeRunSpec({
        runId: "r1",
        cwd: "/tmp",
        model: "claude-opus-5-5",
        fallbackModels: ["claude-sonnet-5-5", "claude-haiku-4-5"],
        allowedTools: ["Read", "Bash(git diff *)"],
        disallowedTools: ["Bash(git push *)"],
        settingsFile: "/run/settings.json",
        mcpConfigFile: "/run/mcp.json",
        appendSystemPromptFile: "/run/primer.md",
        session: { mode: "new", sessionId: "uuid-1" },
      }),
    );
    expect(args.slice(0, 6)).toEqual([
      "-p",
      "--output-format",
      "stream-json",
      "--input-format",
      "stream-json",
      "--verbose",
    ]);
    expect(args).toContain("--strict-mcp-config");
    expect(args[args.indexOf("--model") + 1]).toBe("claude-opus-5-5");
    expect(args[args.indexOf("--fallback-model") + 1]).toBe("claude-sonnet-5-5,claude-haiku-4-5");
    expect(args[args.indexOf("--session-id") + 1]).toBe("uuid-1");
    expect(args[args.indexOf("--settings") + 1]).toBe("/run/settings.json");
    expect(args[args.indexOf("--append-system-prompt-file") + 1]).toBe("/run/primer.md");
    expect(
      args.slice(args.indexOf("--allowedTools") + 1, args.indexOf("--disallowedTools")),
    ).toEqual(["Read", "Bash(git diff *)"]);
    expect(args).not.toContain("--resume");
  });

  it("terminates variadic tool lists with another flag", () => {
    const args = buildClaudeArgs(
      makeRunSpec({ runId: "r1", cwd: "/tmp", allowedTools: ["Read"], disallowedTools: ["Bash"] }),
    );
    const afterDisallowed = args[args.indexOf("--disallowedTools") + 2];
    expect(afterDisallowed?.startsWith("--")).toBe(true);
  });

  it("resumes an existing session", () => {
    const args = buildClaudeArgs(
      makeRunSpec({ runId: "r1", cwd: "/tmp", session: { mode: "resume", sessionId: "uuid-2" } }),
    );
    expect(args[args.indexOf("--resume") + 1]).toBe("uuid-2");
    expect(args).not.toContain("--session-id");
  });

  it("disables persistence for ephemeral runs and omits empty options", () => {
    const args = buildClaudeArgs(
      makeRunSpec({ runId: "r1", cwd: "/tmp", session: { mode: "ephemeral" } }),
    );
    expect(args).toContain("--no-session-persistence");
    expect(args).not.toContain("--fallback-model");
    expect(args).not.toContain("--allowedTools");
    expect(args).not.toContain("--mcp-config");
    expect(args).not.toContain("--include-partial-messages");
  });
});
