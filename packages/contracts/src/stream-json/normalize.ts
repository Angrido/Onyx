import { EMPTY_USAGE, type TokenUsage } from "../domain";
import {
  RawAssistantEventSchema,
  RawResultEventSchema,
  RawStreamEventSchema,
  RawSystemEventSchema,
  RawUserEventSchema,
} from "./raw";
import {
  OnyxRunItemSchema,
  StoredItemsPayloadSchema,
  type ModelUsage,
  type RunItem,
} from "./run-items";

export const MAX_TOOL_RESULT_CHARS = 4_000;
export const MAX_TOOL_INPUT_CHARS = 8_000;
export const ONYX_EVENT_TYPE = "onyx";
export const ONYX_ITEMS_EVENT_TYPE = "onyx.items";

export interface TextDelta {
  index: number;
  text: string;
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readCount(source: UnknownRecord, ...keys: string[]): number {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
      return Math.trunc(value);
    }
  }
  return 0;
}

function readNumber(source: UnknownRecord, ...keys: string[]): number | null {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

function toIntOrNull(value: number | undefined): number | null {
  return value === undefined ? null : Math.trunc(value);
}

export function toTokenUsage(raw: unknown): TokenUsage {
  if (!isRecord(raw)) return EMPTY_USAGE;
  return {
    inputTokens: readCount(raw, "input_tokens", "inputTokens"),
    outputTokens: readCount(raw, "output_tokens", "outputTokens"),
    cacheCreationTokens: readCount(raw, "cache_creation_input_tokens", "cacheCreationInputTokens"),
    cacheReadTokens: readCount(raw, "cache_read_input_tokens", "cacheReadInputTokens"),
  };
}

function toModelUsage(raw: unknown): Record<string, ModelUsage> {
  if (!isRecord(raw)) return {};
  const entries = Object.entries(raw).flatMap(([model, value]) =>
    isRecord(value)
      ? [
          [
            model,
            {
              usage: toTokenUsage(value),
              costUsd: readNumber(value, "costUSD", "costUsd", "cost_usd"),
            },
          ] as const,
        ]
      : [],
  );
  return Object.fromEntries(entries);
}

export function truncateText(text: string, max: number): { text: string; truncated: boolean } {
  return text.length <= max
    ? { text, truncated: false }
    : { text: text.slice(0, max), truncated: true };
}

function stringifyToolResultContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (!isRecord(part)) return "";
        if (part.type === "text" && typeof part.text === "string") return part.text;
        if (part.type === "image") return "[image]";
        return "";
      })
      .filter((part) => part.length > 0)
      .join("\n");
  }
  return content === undefined || content === null ? "" : JSON.stringify(content);
}

function boundToolInput(input: unknown): { input: unknown; inputTruncated: boolean } {
  const serialized = JSON.stringify(input ?? null);
  if (serialized.length <= MAX_TOOL_INPUT_CHARS)
    return { input: input ?? null, inputTruncated: false };
  return {
    input: { preview: serialized.slice(0, MAX_TOOL_INPUT_CHARS) },
    inputTruncated: true,
  };
}

function normalizeSystem(raw: unknown): RunItem[] {
  const parsed = RawSystemEventSchema.safeParse(raw);
  if (!parsed.success) return [{ kind: "unknown", type: "system" }];
  const event = parsed.data;
  if (event.subtype === "init" && event.session_id) {
    return [
      {
        kind: "init",
        sessionId: event.session_id,
        model: event.model ?? "unknown",
        tools: event.tools ?? [],
        cwd: event.cwd ?? null,
        permissionMode: event.permissionMode ?? null,
      },
    ];
  }
  return [{ kind: "system", subtype: event.subtype }];
}

function normalizeAssistant(raw: unknown): RunItem[] {
  const parsed = RawAssistantEventSchema.safeParse(raw);
  if (!parsed.success) return [{ kind: "unknown", type: "assistant" }];
  const { message } = parsed.data;
  const messageId = message.id ?? "";
  const parentToolUseId = parsed.data.parent_tool_use_id ?? null;
  const items: RunItem[] = [];

  for (const block of message.content) {
    if (block.type === "text" && typeof block.text === "string" && block.text.length > 0) {
      items.push({ kind: "text", messageId, text: block.text, parentToolUseId });
    } else if (
      block.type === "thinking" &&
      typeof block.thinking === "string" &&
      block.thinking.length > 0
    ) {
      items.push({ kind: "thinking", messageId, text: block.thinking, parentToolUseId });
    } else if (block.type === "tool_use" && typeof block.id === "string") {
      items.push({
        kind: "tool_use",
        messageId,
        toolUseId: block.id,
        name: typeof block.name === "string" ? block.name : "unknown",
        ...boundToolInput(block.input),
        parentToolUseId,
      });
    }
  }

  if (message.usage && messageId.length > 0) {
    items.push({
      kind: "turn_usage",
      messageId,
      model: message.model ?? null,
      usage: toTokenUsage(message.usage),
    });
  }
  return items;
}

function normalizeUser(raw: unknown): RunItem[] {
  const parsed = RawUserEventSchema.safeParse(raw);
  if (!parsed.success) return [{ kind: "unknown", type: "user" }];
  const parentToolUseId = parsed.data.parent_tool_use_id ?? null;
  const { content } = parsed.data.message;
  if (typeof content === "string") {
    return content.length > 0 ? [{ kind: "user_text", text: content, parentToolUseId }] : [];
  }
  const items: RunItem[] = [];
  for (const block of content) {
    if (block.type === "tool_result" && typeof block.tool_use_id === "string") {
      const bounded = truncateText(
        stringifyToolResultContent(block.content),
        MAX_TOOL_RESULT_CHARS,
      );
      items.push({
        kind: "tool_result",
        toolUseId: block.tool_use_id,
        isError: block.is_error === true,
        content: bounded.text,
        truncated: bounded.truncated,
        parentToolUseId,
      });
    } else if (block.type === "text" && typeof block.text === "string" && block.text.length > 0) {
      items.push({ kind: "user_text", text: block.text, parentToolUseId });
    }
  }
  return items;
}

function deniedTarget(input: unknown): string | null {
  if (!isRecord(input)) return null;
  for (const key of ["file_path", "notebook_path", "path", "pattern", "command"]) {
    const value = input[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return null;
}

function normalizeResult(raw: unknown): RunItem[] {
  const parsed = RawResultEventSchema.safeParse(raw);
  if (!parsed.success) return [{ kind: "unknown", type: "result" }];
  const event = parsed.data;
  const denials: RunItem[] = (event.permission_denials ?? []).map((denial) => ({
    kind: "guard",
    source: "permission",
    tool: denial.tool_name ?? "unknown",
    toolUseId: denial.tool_use_id ?? null,
    target: deniedTarget(denial.tool_input),
    rule: null,
    reason: "Denied by the run's permission rules",
  }));
  return [
    ...denials,
    {
      kind: "result",
      subtype: event.subtype,
      isError: event.is_error ?? event.subtype !== "success",
      numTurns: toIntOrNull(event.num_turns),
      durationMs: toIntOrNull(event.duration_ms),
      durationApiMs: toIntOrNull(event.duration_api_ms),
      costUsd: event.total_cost_usd ?? null,
      usage: toTokenUsage(event.usage),
      resultText: event.result ?? null,
      ...(event.structured_output === undefined
        ? {}
        : { structuredOutput: event.structured_output }),
      sessionId: event.session_id ?? null,
      modelUsage: toModelUsage(event.modelUsage ?? event.model_usage),
    },
  ];
}

export function normalizeClaudeEvent(raw: unknown): RunItem[] {
  if (!isRecord(raw) || typeof raw.type !== "string") return [{ kind: "unknown", type: "invalid" }];
  switch (raw.type) {
    case "system":
      return normalizeSystem(raw);
    case "assistant":
      return normalizeAssistant(raw);
    case "user":
      return normalizeUser(raw);
    case "result":
      return normalizeResult(raw);
    case "stream_event":
      return [];
    default:
      return [{ kind: "unknown", type: raw.type }];
  }
}

export function extractTextDelta(raw: unknown): TextDelta | null {
  const parsed = RawStreamEventSchema.safeParse(raw);
  if (!parsed.success) return null;
  const { event } = parsed.data;
  if (event.type !== "content_block_delta" || event.delta?.type !== "text_delta") return null;
  const text = event.delta.text ?? "";
  return text.length > 0 ? { index: event.index ?? 0, text } : null;
}

export function normalizeStoredEvent(type: string, payload: unknown): RunItem[] {
  if (type === ONYX_EVENT_TYPE) {
    const parsed = OnyxRunItemSchema.safeParse(payload);
    return parsed.success ? [parsed.data] : [{ kind: "unknown", type: ONYX_EVENT_TYPE }];
  }
  if (type === ONYX_ITEMS_EVENT_TYPE) {
    const parsed = StoredItemsPayloadSchema.safeParse(payload);
    return parsed.success ? parsed.data.items : [{ kind: "unknown", type: ONYX_ITEMS_EVENT_TYPE }];
  }
  return normalizeClaudeEvent(payload);
}

export class TurnUsageLedger {
  private readonly byMessage = new Map<string, TokenUsage>();

  record(messageId: string, usage: TokenUsage): void {
    this.byMessage.set(messageId, usage);
  }

  recordItems(items: readonly RunItem[]): void {
    for (const item of items) {
      if (item.kind === "turn_usage") this.record(item.messageId, item.usage);
    }
  }

  get turns(): number {
    return this.byMessage.size;
  }

  total(): TokenUsage {
    let inputTokens = 0;
    let outputTokens = 0;
    let cacheCreationTokens = 0;
    let cacheReadTokens = 0;
    for (const usage of this.byMessage.values()) {
      inputTokens += usage.inputTokens;
      outputTokens += usage.outputTokens;
      cacheCreationTokens += usage.cacheCreationTokens;
      cacheReadTokens += usage.cacheReadTokens;
    }
    return { inputTokens, outputTokens, cacheCreationTokens, cacheReadTokens };
  }
}
