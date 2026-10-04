import { describe, expect, it } from "vitest";
import {
  MAX_TOOL_INPUT_CHARS,
  MAX_TOOL_RESULT_CHARS,
  ONYX_EVENT_TYPE,
  TurnUsageLedger,
  extractTextDelta,
  normalizeClaudeEvent,
  normalizeStoredEvent,
  toTokenUsage,
} from "../src";

describe("normalizeClaudeEvent", () => {
  it("maps system init to an init item", () => {
    const items = normalizeClaudeEvent({
      type: "system",
      subtype: "init",
      session_id: "s-1",
      model: "claude-sonnet-5-5",
      tools: ["Read", "Edit"],
      cwd: "/srv/project",
      permissionMode: "acceptEdits",
    });
    expect(items).toEqual([
      {
        kind: "init",
        sessionId: "s-1",
        model: "claude-sonnet-5-5",
        tools: ["Read", "Edit"],
        cwd: "/srv/project",
        permissionMode: "acceptEdits",
      },
    ]);
  });

  it("keeps non-init system events as generic system items", () => {
    expect(normalizeClaudeEvent({ type: "system", subtype: "api_retry" })).toEqual([
      { kind: "system", subtype: "api_retry" },
    ]);
  });

  it("splits assistant content into text, thinking, tool_use and turn usage", () => {
    const items = normalizeClaudeEvent({
      type: "assistant",
      parent_tool_use_id: null,
      message: {
        id: "msg_1",
        model: "claude-opus-5-5",
        content: [
          { type: "thinking", thinking: "" },
          { type: "thinking", thinking: "Plan the change" },
          { type: "text", text: "Reading files" },
          { type: "tool_use", id: "toolu_1", name: "Read", input: { file_path: "a.ts" } },
        ],
        usage: {
          input_tokens: 10,
          output_tokens: 20,
          cache_creation_input_tokens: 30,
          cache_read_input_tokens: 40,
        },
      },
    });
    expect(items.map((item) => item.kind)).toEqual(["thinking", "text", "tool_use", "turn_usage"]);
    expect(items.at(-1)).toEqual({
      kind: "turn_usage",
      messageId: "msg_1",
      model: "claude-opus-5-5",
      usage: { inputTokens: 10, outputTokens: 20, cacheCreationTokens: 30, cacheReadTokens: 40 },
    });
  });

  it("bounds oversized tool inputs", () => {
    const [item] = normalizeClaudeEvent({
      type: "assistant",
      message: {
        id: "msg_2",
        content: [
          {
            type: "tool_use",
            id: "toolu_2",
            name: "Write",
            input: { content: "x".repeat(MAX_TOOL_INPUT_CHARS * 2) },
          },
        ],
      },
    });
    expect(item).toMatchObject({ kind: "tool_use", inputTruncated: true });
  });

  it("stringifies and truncates tool results", () => {
    const items = normalizeClaudeEvent({
      type: "user",
      message: {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "toolu_1",
            is_error: true,
            content: [
              { type: "text", text: "y".repeat(MAX_TOOL_RESULT_CHARS + 10) },
              { type: "image" },
            ],
          },
        ],
      },
    });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: "tool_result", isError: true, truncated: true });
  });

  it("reads result usage, cost and per-model usage in both casings", () => {
    const camel = normalizeClaudeEvent({
      type: "result",
      subtype: "success",
      is_error: false,
      num_turns: 3,
      duration_ms: 1200,
      total_cost_usd: 0.42,
      session_id: "s-1",
      usage: { input_tokens: 5, output_tokens: 6 },
      modelUsage: { "claude-sonnet-5-5": { inputTokens: 5, outputTokens: 6, costUSD: 0.42 } },
    });
    const snake = normalizeClaudeEvent({
      type: "result",
      subtype: "error_max_turns",
      model_usage: { "claude-haiku-4-5": { input_tokens: 1, output_tokens: 2, cost_usd: 0.01 } },
    });
    expect(camel[0]).toMatchObject({
      kind: "result",
      isError: false,
      numTurns: 3,
      costUsd: 0.42,
      modelUsage: { "claude-sonnet-5-5": { costUsd: 0.42 } },
    });
    expect(snake[0]).toMatchObject({
      kind: "result",
      isError: true,
      modelUsage: {
        "claude-haiku-4-5": {
          usage: { inputTokens: 1, outputTokens: 2, cacheCreationTokens: 0, cacheReadTokens: 0 },
          costUsd: 0.01,
        },
      },
    });
  });

  it("keeps the errors Claude Code reports with a failed result", () => {
    const [lost] = normalizeClaudeEvent({
      type: "result",
      subtype: "error_during_execution",
      duration_ms: 0,
      is_error: true,
      num_turns: 0,
      session_id: "3f0c6a52-1b7e-4c35-9a59-0d7cf0b8a111",
      total_cost_usd: 0,
      errors: ["No conversation found with session ID: 3f0c6a52-1b7e-4c35-9a59-0d7cf0b8a111", ""],
    });
    expect(lost).toMatchObject({
      kind: "result",
      subtype: "error_during_execution",
      numTurns: 0,
      errors: ["No conversation found with session ID: 3f0c6a52-1b7e-4c35-9a59-0d7cf0b8a111"],
    });
    const [plain] = normalizeClaudeEvent({ type: "result", subtype: "success" });
    expect(plain).not.toHaveProperty("errors");
  });

  it("degrades unknown and malformed events to unknown items", () => {
    expect(normalizeClaudeEvent("nope")).toEqual([{ kind: "unknown", type: "invalid" }]);
    expect(normalizeClaudeEvent({ type: "future_event" })).toEqual([
      { kind: "unknown", type: "future_event" },
    ]);
    expect(normalizeClaudeEvent({ type: "assistant", message: 3 })).toEqual([
      { kind: "unknown", type: "assistant" },
    ]);
  });
});

describe("normalizeStoredEvent", () => {
  it("validates onyx lifecycle payloads", () => {
    const status = {
      kind: "status",
      status: "RUNNING",
      exitCode: null,
      signal: null,
      message: null,
    };
    expect(normalizeStoredEvent(ONYX_EVENT_TYPE, status)).toEqual([status]);
    expect(normalizeStoredEvent(ONYX_EVENT_TYPE, { kind: "status", status: "BOGUS" })).toEqual([
      { kind: "unknown", type: ONYX_EVENT_TYPE },
    ]);
  });
});

describe("extractTextDelta", () => {
  it("returns text deltas only", () => {
    expect(
      extractTextDelta({
        type: "stream_event",
        event: { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "Hi" } },
      }),
    ).toEqual({ index: 1, text: "Hi" });
    expect(extractTextDelta({ type: "stream_event", event: { type: "message_start" } })).toBeNull();
  });
});

describe("TurnUsageLedger", () => {
  it("counts each message once even when split across events", () => {
    const ledger = new TurnUsageLedger();
    ledger.record("msg_1", toTokenUsage({ input_tokens: 1, output_tokens: 5 }));
    ledger.record("msg_1", toTokenUsage({ input_tokens: 1, output_tokens: 9 }));
    ledger.record("msg_2", toTokenUsage({ input_tokens: 2, output_tokens: 1 }));
    expect(ledger.turns).toBe(2);
    expect(ledger.total()).toEqual({
      inputTokens: 3,
      outputTokens: 10,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
    });
  });
});

describe("permission denials", () => {
  it("become guard items ahead of the result", () => {
    const items = normalizeClaudeEvent({
      type: "result",
      subtype: "success",
      is_error: false,
      permission_denials: [
        { tool_name: "Read", tool_use_id: "toolu_1", tool_input: { file_path: "/srv/p/.env" } },
        { tool_name: "Bash", tool_use_id: "toolu_2", tool_input: { command: "cat dist/a.js" } },
      ],
    });
    expect(items.map((item) => item.kind)).toEqual(["guard", "guard", "result"]);
    expect(items[0]).toEqual({
      kind: "guard",
      source: "permission",
      tool: "Read",
      toolUseId: "toolu_1",
      target: "/srv/p/.env",
      rule: null,
      reason: "Denied by the run's permission rules",
    });
  });
});
