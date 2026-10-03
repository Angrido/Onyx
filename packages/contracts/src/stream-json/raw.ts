import { z } from "zod";

const ContentBlockSchema = z.looseObject({ type: z.string() });

const UsageRecordSchema = z.record(z.string(), z.unknown());

export const RawSystemEventSchema = z.looseObject({
  type: z.literal("system"),
  subtype: z.string(),
  session_id: z.string().optional(),
  model: z.string().optional(),
  tools: z.array(z.string()).optional(),
  cwd: z.string().optional(),
  permissionMode: z.string().optional(),
});
export type RawSystemEvent = z.infer<typeof RawSystemEventSchema>;

export const RawAssistantEventSchema = z.looseObject({
  type: z.literal("assistant"),
  message: z.looseObject({
    id: z.string().optional(),
    model: z.string().optional(),
    content: z.array(ContentBlockSchema).default([]),
    usage: UsageRecordSchema.optional(),
  }),
  parent_tool_use_id: z.string().nullable().optional(),
  session_id: z.string().optional(),
});
export type RawAssistantEvent = z.infer<typeof RawAssistantEventSchema>;

export const RawUserEventSchema = z.looseObject({
  type: z.literal("user"),
  message: z.looseObject({
    content: z.union([z.string(), z.array(ContentBlockSchema)]),
  }),
  parent_tool_use_id: z.string().nullable().optional(),
  session_id: z.string().optional(),
});
export type RawUserEvent = z.infer<typeof RawUserEventSchema>;

export const RawResultEventSchema = z.looseObject({
  type: z.literal("result"),
  subtype: z.string(),
  is_error: z.boolean().optional(),
  duration_ms: z.number().optional(),
  duration_api_ms: z.number().optional(),
  num_turns: z.number().optional(),
  result: z.string().optional(),
  session_id: z.string().optional(),
  total_cost_usd: z.number().optional(),
  usage: UsageRecordSchema.optional(),
  modelUsage: UsageRecordSchema.optional(),
  model_usage: UsageRecordSchema.optional(),
});
export type RawResultEvent = z.infer<typeof RawResultEventSchema>;

export const RawStreamEventSchema = z.looseObject({
  type: z.literal("stream_event"),
  event: z.looseObject({
    type: z.string(),
    index: z.number().optional(),
    delta: z.looseObject({ type: z.string(), text: z.string().optional() }).optional(),
  }),
  parent_tool_use_id: z.string().nullable().optional(),
  session_id: z.string().optional(),
});
export type RawStreamEvent = z.infer<typeof RawStreamEventSchema>;

export const StreamJsonUserInputSchema = z.object({
  type: z.literal("user"),
  message: z.object({
    role: z.literal("user"),
    content: z.array(z.object({ type: z.literal("text"), text: z.string() })),
  }),
});
export type StreamJsonUserInput = z.infer<typeof StreamJsonUserInputSchema>;

export function buildUserInputMessage(text: string): StreamJsonUserInput {
  return {
    type: "user",
    message: { role: "user", content: [{ type: "text", text }] },
  };
}
