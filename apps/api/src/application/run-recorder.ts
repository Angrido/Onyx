import type { StreamJsonEvent } from "@onyx/agent-runtime";
import {
  ONYX_EVENT_TYPE,
  ONYX_ITEMS_EVENT_TYPE,
  TurnUsageLedger,
  contextTokensOf,
  extractTextDelta,
  normalizeClaudeEvent,
  type OnyxRunItem,
  type RunItem,
  type RunItemOf,
  type TokenUsage,
} from "@onyx/contracts";
import type { EventWriter } from "../infrastructure/event-writer";
import type { RunEventPublisher } from "../infrastructure/ws-hub";

export const MAX_RAW_PAYLOAD_CHARS = 256 * 1024;

export interface TurnUsageRecord {
  messageId: string;
  model: string | null;
  usage: TokenUsage;
}

const EDIT_TOOL_KEYS: Readonly<Record<string, string>> = {
  Edit: "file_path",
  MultiEdit: "file_path",
  Write: "file_path",
  NotebookEdit: "notebook_path",
};

export interface RecordedRead {
  path: string;
  partial: boolean;
  content: string;
  truncated: boolean;
}

function readRequest(toolName: string, input: unknown): { path: string; partial: boolean } | null {
  if (toolName !== "Read" || input === null || typeof input !== "object") return null;
  const record = input as Record<string, unknown>;
  const path = record["file_path"];
  if (typeof path !== "string" || path.length === 0) return null;
  return { path, partial: record["offset"] !== undefined || record["limit"] !== undefined };
}

function editedPath(toolName: string, input: unknown): string | null {
  const key = EDIT_TOOL_KEYS[toolName];
  if (key === undefined || input === null || typeof input !== "object") return null;
  const value = (input as Record<string, unknown>)[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

export class RunRecorder {
  private seq = 0;
  private readonly ledger = new TurnUsageLedger();
  private readonly turns = new Map<string, TurnUsageRecord>();
  private lastTurn: TokenUsage | null = null;
  private firstTurn: TokenUsage | null = null;
  private compactions = 0;
  private limited = false;
  private resultItem: RunItemOf<"result"> | null = null;
  private initItem: RunItemOf<"init"> | null = null;
  private guards = 0;
  private readonly pendingEdits = new Map<string, string>();
  private readonly edited = new Set<string>();
  private readonly deniedToolUses = new Set<string>();
  private readonly pendingReads = new Map<string, { path: string; partial: boolean }>();
  private readonly completedReads: RecordedRead[] = [];

  constructor(
    private readonly runId: string,
    private readonly writer: EventWriter,
    private readonly publisher: RunEventPublisher,
    private readonly onInit: (init: RunItemOf<"init">) => void = () => undefined,
    private readonly onRateLimit: (item: RunItemOf<"rate_limit">) => void = () => undefined,
  ) {}

  get lastSeq(): number {
    return this.seq;
  }

  get result(): RunItemOf<"result"> | null {
    return this.resultItem;
  }

  get init(): RunItemOf<"init"> | null {
    return this.initItem;
  }

  get usage(): TokenUsage {
    return this.resultItem?.usage ?? this.ledger.total();
  }

  get rateLimited(): boolean {
    return this.limited;
  }

  get compacted(): boolean {
    return this.compactions > 0;
  }

  get firstMainTurn(): TokenUsage | null {
    return this.firstTurn;
  }

  get lastContextTokens(): number {
    return this.lastTurn === null ? 0 : contextTokensOf(this.lastTurn);
  }

  get guardDenials(): number {
    return this.guards;
  }

  get changedFiles(): string[] {
    return [...this.edited];
  }

  get reads(): readonly RecordedRead[] {
    return this.completedReads;
  }

  turnUsages(): TurnUsageRecord[] {
    return [...this.turns.values()];
  }

  recordClaudeEvent(event: StreamJsonEvent): void {
    if (event.type === "stream_event") {
      const delta = extractTextDelta(event);
      if (delta) this.publisher.publishRunDelta(this.runId, delta.index, delta.text);
      return;
    }
    const items = normalizeClaudeEvent(event);
    this.track(items);
    const subtype = typeof event.subtype === "string" ? event.subtype : null;
    if (JSON.stringify(event).length <= MAX_RAW_PAYLOAD_CHARS) {
      this.append(String(event.type), subtype, event, items);
    } else {
      this.append(ONYX_ITEMS_EVENT_TYPE, String(event.type), { items }, items);
    }
  }

  recordOnyx(item: OnyxRunItem): void {
    this.track([item]);
    this.append(ONYX_EVENT_TYPE, item.kind, item, [item]);
  }

  private track(items: readonly RunItem[]): void {
    for (const item of items) {
      if (item.kind === "turn_usage") {
        this.ledger.record(item.messageId, item.usage);
        this.turns.set(item.messageId, {
          messageId: item.messageId,
          model: item.model,
          usage: item.usage,
        });
        if (item.parentToolUseId === null) {
          this.firstTurn ??= item.usage;
          this.lastTurn = item.usage;
        }
      } else if (item.kind === "result") {
        this.resultItem = item;
      } else if (item.kind === "system" && item.subtype === "compact_boundary") {
        this.compactions += 1;
      } else if (item.kind === "rate_limit") {
        if (item.status === "rejected") this.limited = true;
        this.onRateLimit(item);
      } else if (item.kind === "init") {
        this.initItem = item;
        this.onInit(item);
      } else if (item.kind === "tool_use") {
        const path = editedPath(item.name, item.input);
        if (path !== null) this.pendingEdits.set(item.toolUseId, path);
        const read = readRequest(item.name, item.input);
        if (read !== null) this.pendingReads.set(item.toolUseId, read);
      } else if (item.kind === "tool_result") {
        const path = this.pendingEdits.get(item.toolUseId);
        if (path !== undefined) {
          this.pendingEdits.delete(item.toolUseId);
          if (!item.isError) this.edited.add(path);
        }
        const read = this.pendingReads.get(item.toolUseId);
        if (read !== undefined) {
          this.pendingReads.delete(item.toolUseId);
          if (!item.isError)
            this.completedReads.push({ ...read, content: item.content, truncated: item.truncated });
        }
      } else if (item.kind === "guard") {
        if (item.toolUseId !== null && this.deniedToolUses.has(item.toolUseId)) continue;
        if (item.toolUseId !== null) this.deniedToolUses.add(item.toolUseId);
        this.guards += 1;
      }
    }
  }

  private append(type: string, subtype: string | null, payload: unknown, items: RunItem[]): void {
    this.seq += 1;
    this.writer.enqueue({ runId: this.runId, seq: this.seq, type, subtype, payload });
    this.publisher.publishRunEvent(this.runId, this.seq, new Date().toISOString(), items);
  }
}
