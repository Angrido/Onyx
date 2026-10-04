import type { RunItem } from "@onyx/contracts";
import { describe, expect, it } from "vitest";
import {
  INITIAL_FEED,
  activeTool,
  applyDelta,
  applyRunEvent,
  contextSavings,
  feedUsage,
  isTerminal,
  toolFamily,
} from "@/lib/run-feed";

const usage = (input: number, output: number) => ({
  inputTokens: input,
  outputTokens: output,
  cacheCreationTokens: 0,
  cacheReadTokens: 0,
});

describe("run feed", () => {
  it("pairs tool results with their tool calls", () => {
    let state = applyRunEvent(INITIAL_FEED, 1, [
      {
        kind: "tool_use",
        messageId: "m1",
        toolUseId: "t1",
        name: "Read",
        input: { file_path: "a.ts" },
        inputTruncated: false,
        parentToolUseId: null,
      },
    ]);
    state = applyRunEvent(state, 2, [
      {
        kind: "tool_result",
        toolUseId: "t1",
        isError: false,
        content: "file body",
        truncated: false,
        parentToolUseId: null,
      },
    ]);
    expect(state.entries).toHaveLength(1);
    expect(state.entries[0]).toMatchObject({
      kind: "tool",
      name: "Read",
      result: { content: "file body", isError: false },
    });
  });

  it("ignores replayed sequence numbers", () => {
    const item: RunItem = { kind: "prompt", text: "hi" };
    const once = applyRunEvent(INITIAL_FEED, 1, [item]);
    const twice = applyRunEvent(once, 1, [item]);
    expect(twice).toBe(once);
  });

  it("deduplicates turn usage per message and prefers the result totals", () => {
    let state = applyRunEvent(INITIAL_FEED, 1, [
      { kind: "turn_usage", messageId: "m1", model: null, usage: usage(1, 5) },
    ]);
    state = applyRunEvent(state, 2, [
      { kind: "turn_usage", messageId: "m1", model: null, usage: usage(1, 9) },
      { kind: "turn_usage", messageId: "m2", model: null, usage: usage(2, 1) },
    ]);
    expect(feedUsage(state)).toEqual(usage(3, 10));

    state = applyRunEvent(state, 3, [
      {
        kind: "result",
        subtype: "success",
        isError: false,
        numTurns: 2,
        durationMs: 1,
        durationApiMs: 1,
        costUsd: 0.1,
        usage: usage(30, 100),
        resultText: "done",
        sessionId: "s",
        modelUsage: {},
      },
    ]);
    expect(feedUsage(state)).toEqual(usage(30, 100));
  });

  it("merges consecutive stderr chunks and tracks status", () => {
    let state = applyRunEvent(INITIAL_FEED, 1, [{ kind: "stderr", text: "a" }]);
    state = applyRunEvent(state, 2, [{ kind: "stderr", text: "b" }]);
    state = applyRunEvent(state, 3, [
      { kind: "status", status: "FAILED", exitCode: 1, signal: null, message: "boom" },
    ]);
    expect(state.entries.map((entry) => entry.kind)).toEqual(["stderr", "status"]);
    expect(state.entries[0]).toMatchObject({ text: "ab" });
    expect(isTerminal(state.status)).toBe(true);
  });

  it("accumulates partial text until the assistant message lands", () => {
    let state = applyDelta(applyDelta(INITIAL_FEED, "Hel"), "lo");
    expect(state.partialText).toBe("Hello");
    state = applyRunEvent(state, 1, [
      { kind: "text", messageId: "m1", text: "Hello", parentToolUseId: null },
    ]);
    expect(state.partialText).toBe("");
  });
});

describe("context items", () => {
  it("adds a context entry and exposes the pack saving", () => {
    const context = {
      kind: "context" as const,
      targets: ["src/a.ts"],
      inferredTargets: [],
      entries: [
        {
          relPath: "src/a.ts",
          role: "target" as const,
          level: 3 as const,
          tokens: 400,
          symbols: null,
        },
      ],
      mapTokens: 120,
      packTokens: 500,
      baselineTokens: 2_000,
      deliveredTokens: 620,
      indexedAt: null,
      mcpEnabled: true,
      note: null,
      arm: null,
    };
    const state = applyRunEvent(INITIAL_FEED, 1, [context]);
    expect(state.entries.at(-1)).toEqual({ kind: "context", key: "1:0", item: context });
    expect(state.context).toBe(context);
    expect(contextSavings(context)).toBeCloseTo(0.69);
    expect(contextSavings({ ...context, baselineTokens: 0 })).toBeNull();
  });
});

describe("guard items", () => {
  it("counts each blocked tool call once across hook and CLI reports", () => {
    const hook = {
      kind: "guard" as const,
      source: "hook" as const,
      tool: "Read",
      toolUseId: "toolu_1",
      target: "dist/a.js",
      rule: "dist/",
      reason: "outside the context",
    };
    const reported = { ...hook, source: "permission" as const, target: "/srv/p/dist/a.js" };
    const anonymous = { ...reported, toolUseId: null };
    let state = applyRunEvent(INITIAL_FEED, 1, [hook]);
    state = applyRunEvent(state, 2, [reported, anonymous]);
    expect(state.guardDenials).toBe(2);
    expect(state.entries.map((entry) => entry.kind)).toEqual(["guard", "guard"]);
  });

  it("records routing and session items as feed entries", () => {
    const state = applyRunEvent(INITIAL_FEED, 1, [
      {
        kind: "routing",
        strategy: "RULE",
        tier: "BUILDER",
        modelId: "claude-sonnet-5-5",
        rationale: "Rule ui-styling matched",
        score: null,
        confidence: null,
        ruleName: "ui-styling",
      },
      {
        kind: "session",
        action: "started",
        sessionId: "s2",
        workspaceName: "Frontend",
        reason: "DOMAIN_SWITCH",
        previousSessionId: "s1",
        handoff: { text: "# Handoff for the Frontend workspace", tokens: 120 },
        contextTokens: 0,
        maxSessionTokens: 150_000,
      },
    ]);
    expect(state.entries.map((entry) => entry.kind)).toEqual(["routing", "session"]);
    expect(state.routing?.ruleName).toBe("ui-styling");
    expect(state.session?.handoff?.tokens).toBe(120);
  });
});

describe("active tool", () => {
  it("names the tool the agent is waiting on and its family", () => {
    const running = { ...INITIAL_FEED, status: "RUNNING" as const };
    const calling = applyRunEvent(running, 1, [
      {
        kind: "tool_use",
        messageId: "m1",
        toolUseId: "t1",
        name: "Edit",
        input: {},
        inputTruncated: false,
        parentToolUseId: null,
      },
    ]);
    expect(activeTool(calling)).toBe("Edit");
    const answered = applyRunEvent(calling, 2, [
      {
        kind: "tool_result",
        toolUseId: "t1",
        isError: false,
        content: "ok",
        truncated: false,
        parentToolUseId: null,
      },
    ]);
    expect(activeTool(answered)).toBeNull();
    expect(activeTool({ ...calling, status: "COMPLETED" })).toBeNull();
    expect(toolFamily("Grep")).toBe("read");
    expect(toolFamily("Bash")).toBe("shell");
    expect(toolFamily("mcp__onyx__search_symbols")).toBe("context");
    expect(toolFamily("Task")).toBe("delegate");
    expect(toolFamily("Mystery")).toBe("other");
  });
});
