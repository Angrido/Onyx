import { z } from "zod";
import { RunStatusSchema, TaskStatusSchema } from "./domain";
import { IndexProgressEventSchema } from "./api/context";
import { OrchestrationDtoSchema } from "./api/orchestration";
import { TddLoopDtoSchema } from "./api/tdd";
import { TerminalDtoSchema } from "./api/terminals";
import { RunItemSchema } from "./stream-json/run-items";

import { WS_PROTOCOL_VERSION } from "./client";

export { WS_PROTOCOL_VERSION, channels, runIdFromChannel } from "./client";

export const ChannelSchema = z
  .string()
  .max(96)
  .regex(
    /^(system|(run|task|project|workspace|tdd|pty|orchestration):[A-Za-z0-9_-]+)$/,
    "Invalid channel",
  );
export type Channel = z.infer<typeof ChannelSchema>;

const ClientEnvelopeBase = {
  v: z.literal(WS_PROTOCOL_VERSION),
};

export const ClientMessageSchema = z.discriminatedUnion("type", [
  z.object({
    ...ClientEnvelopeBase,
    type: z.literal("subscribe"),
    data: z.object({
      channels: z.array(ChannelSchema).min(1).max(64),
      since: z.record(z.string(), z.number().int().min(0)).optional(),
    }),
  }),
  z.object({
    ...ClientEnvelopeBase,
    type: z.literal("unsubscribe"),
    data: z.object({ channels: z.array(ChannelSchema).min(1).max(64) }),
  }),
  z.object({
    ...ClientEnvelopeBase,
    type: z.literal("run.abort"),
    data: z.object({ runId: z.string().min(1) }),
  }),
  z.object({
    ...ClientEnvelopeBase,
    type: z.literal("pty.input"),
    data: z.object({ terminalId: z.string().min(1), data: z.string().max(65_536) }),
  }),
  z.object({
    ...ClientEnvelopeBase,
    type: z.literal("pty.resize"),
    data: z.object({
      terminalId: z.string().min(1),
      cols: z.number().int().min(20).max(500),
      rows: z.number().int().min(5).max(200),
    }),
  }),
  z.object({
    ...ClientEnvelopeBase,
    type: z.literal("ping"),
    data: z.object({}).optional(),
  }),
]);
export type ClientMessage = z.infer<typeof ClientMessageSchema>;

export const RunEventDataSchema = z.object({
  runId: z.string(),
  items: z.array(RunItemSchema),
});

export const RunDeltaDataSchema = z.object({
  runId: z.string(),
  index: z.number().int(),
  text: z.string(),
});

export const TaskStatusDataSchema = z.object({
  taskId: z.string(),
  projectId: z.string(),
  status: TaskStatusSchema,
  runId: z.string().nullable(),
});

export const SystemRunsDataSchema = z.object({
  event: z.enum(["queued", "started", "finished"]),
  runId: z.string().nullable(),
  taskId: z.string(),
  status: RunStatusSchema.nullable(),
  activeRuns: z.number().int(),
  queuedTasks: z.number().int(),
});

export const ServerMessageSchema = z.discriminatedUnion("type", [
  z.object({
    v: z.literal(WS_PROTOCOL_VERSION),
    type: z.literal("run.event"),
    ch: ChannelSchema,
    seq: z.number().int(),
    ts: z.string(),
    data: RunEventDataSchema,
  }),
  z.object({
    v: z.literal(WS_PROTOCOL_VERSION),
    type: z.literal("run.delta"),
    ch: ChannelSchema,
    ts: z.string(),
    data: RunDeltaDataSchema,
  }),
  z.object({
    v: z.literal(WS_PROTOCOL_VERSION),
    type: z.literal("task.status"),
    ch: ChannelSchema,
    seq: z.number().int(),
    ts: z.string(),
    data: TaskStatusDataSchema,
  }),
  z.object({
    v: z.literal(WS_PROTOCOL_VERSION),
    type: z.literal("system.runs"),
    ch: ChannelSchema,
    seq: z.number().int(),
    ts: z.string(),
    data: SystemRunsDataSchema,
  }),
  z.object({
    v: z.literal(WS_PROTOCOL_VERSION),
    type: z.literal("pty.output"),
    ch: ChannelSchema,
    ts: z.string(),
    data: z.object({ terminalId: z.string(), data: z.string(), reset: z.boolean() }),
  }),
  z.object({
    v: z.literal(WS_PROTOCOL_VERSION),
    type: z.literal("pty.state"),
    ch: ChannelSchema,
    ts: z.string(),
    data: z.object({ terminal: TerminalDtoSchema }),
  }),
  z.object({
    v: z.literal(WS_PROTOCOL_VERSION),
    type: z.literal("tdd.state"),
    ch: ChannelSchema,
    ts: z.string(),
    data: z.object({ loop: TddLoopDtoSchema }),
  }),
  z.object({
    v: z.literal(WS_PROTOCOL_VERSION),
    type: z.literal("orchestration.state"),
    ch: ChannelSchema,
    ts: z.string(),
    data: z.object({ orchestration: OrchestrationDtoSchema }),
  }),
  z.object({
    v: z.literal(WS_PROTOCOL_VERSION),
    type: z.literal("approvals.changed"),
    ch: ChannelSchema,
    ts: z.string(),
    data: z.object({ pending: z.number().int() }),
  }),
  z.object({
    v: z.literal(WS_PROTOCOL_VERSION),
    type: z.literal("index.progress"),
    ch: ChannelSchema,
    ts: z.string(),
    data: IndexProgressEventSchema,
  }),
  z.object({
    v: z.literal(WS_PROTOCOL_VERSION),
    type: z.literal("subscribed"),
    ts: z.string(),
    data: z.object({ channels: z.array(z.string()) }),
  }),
  z.object({
    v: z.literal(WS_PROTOCOL_VERSION),
    type: z.literal("error"),
    ts: z.string(),
    data: z.object({ code: z.string(), message: z.string() }),
  }),
  z.object({
    v: z.literal(WS_PROTOCOL_VERSION),
    type: z.literal("pong"),
    ts: z.string(),
  }),
]);
export type ServerMessage = z.infer<typeof ServerMessageSchema>;
export type ServerMessageType = ServerMessage["type"];
export type ServerMessageOf<T extends ServerMessageType> = Extract<ServerMessage, { type: T }>;
export type SequencedServerMessage = ServerMessageOf<"run.event" | "task.status" | "system.runs">;
