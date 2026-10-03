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

export class RunRecorder {
  private seq = 0;
  private readonly ledger = new TurnUsageLedger();
  private readonly turns = new Map<string, TurnUsageRecord>();
  private lastTurn: TokenUsage | null = null;
  private resultItem: RunItemOf<"result"> | null = null;
  private initItem: RunItemOf<"init"> | null = null;

  constructor(
    private readonly runId: string,
    private readonly writer: EventWriter,
    private readonly publisher: RunEventPublisher,
    private readonly onInit: (init: RunItemOf<"init">) => void = () => undefined,
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

  get lastContextTokens(): number {
    return this.lastTurn === null ? 0 : contextTokensOf(this.lastTurn);
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
        this.lastTurn = item.usage;
      } else if (item.kind === "result") {
        this.resultItem = item;
      } else if (item.kind === "init") {
        this.initItem = item;
        this.onInit(item);
      }
    }
  }

  private append(type: string, subtype: string | null, payload: unknown, items: RunItem[]): void {
    this.seq += 1;
    this.writer.enqueue({ runId: this.runId, seq: this.seq, type, subtype, payload });
    this.publisher.publishRunEvent(this.runId, this.seq, new Date().toISOString(), items);
  }
}
