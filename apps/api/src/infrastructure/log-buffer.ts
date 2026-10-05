import {
  LogLevelSchema,
  type LogEntryDto,
  type LogLevel,
  type LogListResponse,
} from "@onyx/contracts";
import { redactText, redactValue } from "../domain/redaction";

export const DEFAULT_LOG_CAPACITY = 2_000;
export const MAX_LOG_TEXT = 4_000;
const MAX_RUN_IDS = 50;
const HEADER_FIELDS = new Set(["level", "time", "msg", "pid", "hostname", "v"]);
const QUIET_MESSAGES = new Set(["incoming request", "request completed"]);

export const LEVEL_VALUES: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

export interface LogFilter {
  level?: LogLevel | undefined;
  runId?: string | undefined;
  q?: string | undefined;
  limit: number;
}

interface StoredEntry {
  entry: LogEntryDto;
  value: number;
  haystack: string;
}

export function levelOf(value: unknown): LogLevel {
  if (typeof value === "string")
    return LogLevelSchema.options.find((level) => level === value) ?? "info";
  if (typeof value !== "number") return "info";
  let found: LogLevel = "trace";
  for (const level of LogLevelSchema.options) if (value >= LEVEL_VALUES[level]) found = level;
  return found;
}

function clip(value: unknown): unknown {
  if (typeof value === "string")
    return value.length > MAX_LOG_TEXT ? `${value.slice(0, MAX_LOG_TEXT)}…` : value;
  if (Array.isArray(value)) return value.map(clip);
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, clip(entry)]),
    );
  return value;
}

function statusCodeOf(record: Record<string, unknown>): number | null {
  const response = record["res"];
  if (response === null || typeof response !== "object") return null;
  const code = (response as Record<string, unknown>)["statusCode"];
  return typeof code === "number" ? code : null;
}

export function isQuietRequest(record: Record<string, unknown>): boolean {
  const message = record["msg"];
  if (typeof message !== "string" || !QUIET_MESSAGES.has(message)) return false;
  const status = statusCodeOf(record);
  return status === null || status < 400;
}

function timeOf(value: unknown): string {
  const date = new Date(
    typeof value === "number" || typeof value === "string" ? value : Date.now(),
  );
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

export class LogBuffer {
  private readonly slots: (StoredEntry | undefined)[];
  private next = 0;
  private size = 0;
  private seq = 0;

  constructor(readonly capacity: number = DEFAULT_LOG_CAPACITY) {
    this.slots = new Array<StoredEntry | undefined>(Math.max(1, capacity));
  }

  get buffered(): number {
    return this.size;
  }

  ingest(line: string): string {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      const text = redactText(line);
      this.record({ level: 30, time: Date.now(), msg: text.trim() });
      return text;
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed))
      return redactText(line);
    const redacted = redactValue(parsed as Record<string, unknown>);
    this.store(redacted);
    return `${JSON.stringify(redacted)}\n`;
  }

  record(record: Record<string, unknown>): void {
    this.store(redactValue(record));
  }

  query(filter: LogFilter): LogListResponse {
    const minimum = filter.level ? LEVEL_VALUES[filter.level] : 0;
    const needle = filter.q?.trim().toLowerCase() ?? "";
    const entries: LogEntryDto[] = [];
    const runIds: string[] = [];
    let matched = 0;
    for (const stored of this.newestFirst()) {
      const runId = stored.entry.runId;
      if (runId !== null && runIds.length < MAX_RUN_IDS && !runIds.includes(runId))
        runIds.push(runId);
      if (stored.value < minimum) continue;
      if (filter.runId && runId !== filter.runId) continue;
      if (needle && !stored.haystack.includes(needle)) continue;
      matched += 1;
      if (entries.length < filter.limit) entries.push(stored.entry);
    }
    return { entries, matched, buffered: this.size, capacity: this.capacity, runIds };
  }

  clear(): void {
    this.slots.fill(undefined);
    this.next = 0;
    this.size = 0;
  }

  private store(record: Record<string, unknown>): void {
    if (isQuietRequest(record)) return;
    const level = levelOf(record["level"]);
    const message = typeof record["msg"] === "string" ? record["msg"] : "";
    const context: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(record))
      if (!HEADER_FIELDS.has(key)) context[key] = clip(value);
    const runId = typeof record["runId"] === "string" ? record["runId"] : null;
    this.seq += 1;
    const entry: LogEntryDto = {
      seq: this.seq,
      time: timeOf(record["time"]),
      level,
      msg: clip(message) as string,
      runId,
      context,
    };
    this.slots[this.next] = {
      entry,
      value: LEVEL_VALUES[level],
      haystack: `${message}\n${JSON.stringify(context)}`.toLowerCase(),
    };
    this.next = (this.next + 1) % this.slots.length;
    this.size = Math.min(this.size + 1, this.slots.length);
  }

  private *newestFirst(): Generator<StoredEntry> {
    for (let offset = 1; offset <= this.size; offset += 1) {
      const index = (this.next - offset + this.slots.length) % this.slots.length;
      const stored = this.slots[index];
      if (stored) yield stored;
    }
  }
}
