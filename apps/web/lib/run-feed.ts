import type {
  ContextItem,
  GuardItem,
  RoutingItem,
  RunItem,
  RunItemOf,
  RunStatus,
  SessionItem,
  TokenUsage,
} from "@onyx/contracts";
import {
  EMPTY_USAGE,
  TERMINAL_RUN_STATUSES,
  addUsage,
  contextTokensOf,
} from "@onyx/contracts/client";

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
  | { kind: "system"; key: string; subtype: string }
  | { kind: "context"; key: string; item: ContextItem }
  | { kind: "guard"; key: string; item: GuardItem }
  | { kind: "routing"; key: string; item: RoutingItem }
  | { kind: "session"; key: string; item: SessionItem }
  | { kind: "rate_limit"; key: string; item: RunItemOf<"rate_limit"> };

export interface FeedState {
  entries: FeedEntry[];
  lastSeq: number;
  status: RunStatus | null;
  model: string | null;
  cwd: string | null;
  turnUsage: Record<string, TokenUsage>;
  lastTurn: TokenUsage | null;
  result: RunItemOf<"result"> | null;
  context: ContextItem | null;
  guardDenials: number;
  routing: RoutingItem | null;
  session: SessionItem | null;
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
  context: null,
  guardDenials: 0,
  routing: null,
  session: null,
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
    case "context":
      entries.push({ kind: "context", key, item });
      return { ...state, context: item };
    case "guard": {
      const duplicate =
        item.toolUseId !== null &&
        entries.some((entry) => entry.kind === "guard" && entry.item.toolUseId === item.toolUseId);
      if (duplicate) return state;
      entries.push({ kind: "guard", key, item });
      return { ...state, guardDenials: state.guardDenials + 1 };
    }
    case "routing":
      entries.push({ kind: "routing", key, item });
      return { ...state, routing: item };
    case "session":
      entries.push({ kind: "session", key, item });
      return { ...state, session: item };
    case "rate_limit":
      entries.push({ kind: "rate_limit", key, item });
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

export function contextSavings(item: ContextItem): number | null {
  if (item.baselineTokens <= 0) return null;
  return 1 - item.deliveredTokens / item.baselineTokens;
}

export type ToolFamily = "read" | "edit" | "shell" | "context" | "delegate" | "web" | "other";

const TOOL_FAMILIES: Record<string, ToolFamily> = {
  Read: "read",
  Grep: "read",
  Glob: "read",
  LS: "read",
  NotebookRead: "read",
  Edit: "edit",
  Write: "edit",
  MultiEdit: "edit",
  NotebookEdit: "edit",
  Bash: "shell",
  BashOutput: "shell",
  KillShell: "shell",
  Task: "delegate",
  Agent: "delegate",
  WebFetch: "web",
  WebSearch: "web",
};

export function toolFamily(name: string): ToolFamily {
  if (name.startsWith("mcp__onyx")) return "context";
  if (name.startsWith("mcp__")) return "web";
  return TOOL_FAMILIES[name] ?? "other";
}

export function activeTool(state: Pick<FeedState, "entries" | "status">): string | null {
  if (isTerminal(state.status)) return null;
  for (let index = state.entries.length - 1; index >= 0; index -= 1) {
    const entry = state.entries[index];
    if (entry?.kind === "tool") return entry.result === null ? entry.name : null;
    if (entry?.kind === "text" && !entry.nested) return null;
  }
  return null;
}
