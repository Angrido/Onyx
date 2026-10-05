import { z } from "zod";
import { LOG_LEVELS } from "../client";
import { IsoDateSchema } from "./common";
import { ReadyResponseSchema } from "./telemetry";

export const LogLevelSchema = z.enum(LOG_LEVELS);
export type LogLevel = z.infer<typeof LogLevelSchema>;

export const LOG_QUERY_MAX = 2_000;

export const LogQuerySchema = z.object({
  level: LogLevelSchema.optional(),
  runId: z.string().trim().min(1).max(64).optional(),
  q: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(LOG_QUERY_MAX).default(300),
});
export type LogQuery = z.input<typeof LogQuerySchema>;

export const LogEntryDtoSchema = z.object({
  seq: z.number().int(),
  time: IsoDateSchema,
  level: LogLevelSchema,
  msg: z.string(),
  runId: z.string().nullable(),
  context: z.record(z.string(), z.unknown()),
});
export type LogEntryDto = z.infer<typeof LogEntryDtoSchema>;

export const LogListResponseSchema = z.object({
  entries: z.array(LogEntryDtoSchema),
  matched: z.number().int(),
  buffered: z.number().int(),
  capacity: z.number().int(),
  runIds: z.array(z.string()),
});
export type LogListResponse = z.infer<typeof LogListResponseSchema>;

export const DiagnosticsTableCountSchema = z.object({
  table: z.string(),
  rows: z.number().int().nullable(),
});

export const DiskUsageSchema = z.object({
  name: z.string(),
  path: z.string(),
  freeBytes: z.number().nullable(),
  totalBytes: z.number().nullable(),
  freeRatio: z.number().nullable(),
  error: z.string().nullable(),
});
export type DiskUsage = z.infer<typeof DiskUsageSchema>;

export const DiagnosticsBundleSchema = z.object({
  format: z.literal(1),
  generatedAt: IsoDateSchema,
  onyx: z.object({
    version: z.string().nullable(),
    commit: z.string().nullable(),
    uptimeSec: z.number(),
  }),
  runtime: z.object({
    node: z.string(),
    platform: z.string(),
    release: z.string(),
    arch: z.string(),
    cpus: z.number().int(),
    memoryBytes: z.number(),
  }),
  claude: z.object({
    version: z.string().nullable(),
    compatible: z.boolean().nullable(),
    missing: z.array(z.string()),
    error: z.string().nullable(),
  }),
  config: z.record(z.string(), z.unknown()),
  secrets: z.record(z.string(), z.enum(["set", "not set"])),
  readiness: ReadyResponseSchema,
  recovery: z.unknown().nullable(),
  logs: z.object({
    capacity: z.number().int(),
    buffered: z.number().int(),
    recent: z.array(LogEntryDtoSchema),
  }),
  database: z.object({
    fileBytes: z.number().nullable(),
    walBytes: z.number().nullable(),
    migrations: z.number().int(),
    lastMigration: z.string().nullable(),
    tables: z.array(DiagnosticsTableCountSchema),
    error: z.string().nullable(),
  }),
  queue: z.object({
    running: z.number().int(),
    queued: z.number().int(),
    maxConcurrent: z.number().int(),
    reservedSlots: z.number().int(),
    waiting: z.record(z.string(), z.number().int()),
    projectLimit: z.number().int().nullable(),
  }),
  disk: z.array(DiskUsageSchema),
});
export type DiagnosticsBundle = z.infer<typeof DiagnosticsBundleSchema>;
