import type { PrismaClient } from "@onyx/db";

export interface AgentEventRow {
  runId: string;
  seq: number;
  type: string;
  subtype: string | null;
  payload: unknown;
  items?: unknown;
}

export interface EventWriterOptions {
  flushIntervalMs?: number;
  maxBatchSize?: number;
  onError?: (error: unknown, rows: AgentEventRow[]) => void;
}

export class EventWriter {
  private queue: AgentEventRow[] = [];
  private timer: NodeJS.Timeout | null = null;
  private inFlight: Promise<void> = Promise.resolve();
  private closed = false;
  private readonly flushIntervalMs: number;
  private readonly maxBatchSize: number;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly options: EventWriterOptions = {},
  ) {
    this.flushIntervalMs = options.flushIntervalMs ?? 50;
    this.maxBatchSize = options.maxBatchSize ?? 100;
  }

  get pendingCount(): number {
    return this.queue.length;
  }

  enqueue(row: AgentEventRow): void {
    if (this.closed) throw new Error("EventWriter is closed");
    this.queue.push(row);
    if (this.queue.length >= this.maxBatchSize) {
      void this.flush();
    } else if (this.timer === null) {
      this.timer = setTimeout(() => void this.flush(), this.flushIntervalMs);
      this.timer.unref();
    }
  }

  flush(): Promise<void> {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const batch = this.queue;
    this.queue = [];
    this.inFlight = this.inFlight.then(() => (batch.length > 0 ? this.write(batch) : undefined));
    return this.inFlight;
  }

  async close(): Promise<void> {
    await this.flush();
    this.closed = true;
  }

  private async write(rows: AgentEventRow[]): Promise<void> {
    try {
      await this.prisma.agentEvent.createMany({
        data: rows.map((row) => ({
          runId: row.runId,
          seq: row.seq,
          type: row.type,
          subtype: row.subtype,
          payload: row.payload as object,
          ...(row.items === undefined ? {} : { items: row.items as object }),
        })),
      });
    } catch (error) {
      this.options.onError?.(error, rows);
    }
  }
}
