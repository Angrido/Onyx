import {
  EMPTY_USAGE,
  TERMINAL_RUN_STATUSES,
  addUsage,
  contextTokensOf,
  type RunItem,
  type RunItemOf,
  type RunStatus,
  type TokenUsage,
} from "@onyx/contracts";

export interface ToolResultView {
  content: string;
  isError: boolean;
  truncated: boolean;
}

export type FeedEntry =
  | { kind: "prompt"; key: string; text: string }
  | {
      kind: "init";
      key: string;
      model: string;
      sessionId: string;
      tools: string[];
      cwd: string | null;
    }
  | { kind: "text"; key: string; text: string; nested: boolean }
  | { kind: "thinking"; key: string; text: string; nested: boolean }
  | {
      kind: "tool";
      key: string;
      toolUseId: string;
      name: string;
      input: unknown;
      inputTruncated: boolean;
      nested: boolean;
      result: ToolResultView | null;
    }
  | { kind: "user"; key: string; text: string; nested: boolean }
  | { kind: "status"; key: string; status: RunStatus; message: string | null }
  | { kind: "stderr"; key: string; text: string }
  | { kind: "result"; key: string; item: RunItemOf<"result"> }
  | { kind: "system"; key: string; subtype: string };

export interface FeedState {
  entries: FeedEntry[];
  lastSeq: number;
  status: RunStatus | null;
  model: string | null;
  cwd: string | null;
  turnUsage: Record<string, TokenUsage>;
  lastTurn: TokenUsage | null;
  result: RunItemOf<"result"> | null;
  partialText: string;
}

export const INITIAL_FEED: FeedState = {
  entries: [],
  lastSeq: 0,
  status: null,
  model: null,
  cwd: null,
  turnUsage: {},
  lastTurn: null,
  result: null,
  partialText: "",
};

function appendItem(state: FeedState, entries: FeedEntry[], item: RunItem, key: string): FeedState {
  switch (item.kind) {
    case "prompt":
      entries.push({ kind: "prompt", key, text: item.text });
      return state;
    case "init":
      entries.push({
        kind: "init",
        key,
        model: item.model,
        sessionId: item.sessionId,
        tools: item.tools,
        cwd: item.cwd,
      });
      return { ...state, model: item.model, cwd: item.cwd };
    case "text":
      entries.push({ kind: "text", key, text: item.text, nested: item.parentToolUseId !== null });
      return { ...state, partialText: "" };
    case "thinking":
      entries.push({
        kind: "thinking",
        key,
        text: item.text,
        nested: item.parentToolUseId !== null,
      });
      return state;
    case "tool_use":
      entries.push({
        kind: "tool",
        key,
        toolUseId: item.toolUseId,
        name: item.name,
        input: item.input,
        inputTruncated: item.inputTruncated,
        nested: item.parentToolUseId !== null,
        result: null,
      });
      return state;
    case "tool_result": {
      const index = entries.findLastIndex(
        (entry) => entry.kind === "tool" && entry.toolUseId === item.toolUseId,
      );
      const target = entries[index];
      if (target?.kind === "tool") {
        entries[index] = {
          ...target,
          result: { content: item.content, isError: item.isError, truncated: item.truncated },
        };
      }
      return state;
    }
    case "user_text":
      entries.push({ kind: "user", key, text: item.text, nested: item.parentToolUseId !== null });
      return state;
    case "turn_usage":
      return {
        ...state,
        turnUsage: { ...state.turnUsage, [item.messageId]: item.usage },
        lastTurn: item.usage,
      };
    case "result":
      entries.push({ kind: "result", key, item });
      return { ...state, result: item };
    case "status":
      entries.push({ kind: "status", key, status: item.status, message: item.message });
      return { ...state, status: item.status };
    case "stderr": {
      const last = entries.at(-1);
      if (last?.kind === "stderr") {
        entries[entries.length - 1] = { ...last, text: `${last.text}${item.text}` };
      } else {
        entries.push({ kind: "stderr", key, text: item.text });
      }
      return state;
    }
    case "system":
      entries.push({ kind: "system", key, subtype: item.subtype });
      return state;
    case "unknown":
      return state;
  }
}

export function applyRunEvent(state: FeedState, seq: number, items: readonly RunItem[]): FeedState {
  if (seq <= state.lastSeq) return state;
  const entries = [...state.entries];
  let next: FeedState = { ...state, lastSeq: seq };
  items.forEach((item, index) => {
    next = appendItem(next, entries, item, `${seq}:${index}`);
  });
  return { ...next, entries };
}

export function applyDelta(state: FeedState, text: string): FeedState {
  return { ...state, partialText: `${state.partialText}${text}` };
}

export function feedUsage(state: FeedState): TokenUsage {
  if (state.result) return state.result.usage;
  return Object.values(state.turnUsage).reduce(addUsage, EMPTY_USAGE);
}

export function feedContextTokens(state: FeedState): number {
  return state.lastTurn ? contextTokensOf(state.lastTurn) : 0;
}

export function isTerminal(status: RunStatus | null): boolean {
  return status !== null && TERMINAL_RUN_STATUSES.includes(status);
}
