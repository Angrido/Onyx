import { z } from "zod";
import { RunStatusSchema, TokenUsageSchema } from "../domain";

export const ModelUsageSchema = z.object({
  usage: TokenUsageSchema,
  costUsd: z.number().nullable(),
});
export type ModelUsage = z.infer<typeof ModelUsageSchema>;

const ParentToolUseIdSchema = z.string().nullable();

export const InitItemSchema = z.object({
  kind: z.literal("init"),
  sessionId: z.string(),
  model: z.string(),
  tools: z.array(z.string()),
  cwd: z.string().nullable(),
  permissionMode: z.string().nullable(),
});

export const SystemItemSchema = z.object({
  kind: z.literal("system"),
  subtype: z.string(),
});

export const PromptItemSchema = z.object({
  kind: z.literal("prompt"),
  text: z.string(),
});

export const UserTextItemSchema = z.object({
  kind: z.literal("user_text"),
  text: z.string(),
  parentToolUseId: ParentToolUseIdSchema,
});

export const TextItemSchema = z.object({
  kind: z.literal("text"),
  messageId: z.string(),
  text: z.string(),
  parentToolUseId: ParentToolUseIdSchema,
});

export const ThinkingItemSchema = z.object({
  kind: z.literal("thinking"),
  messageId: z.string(),
  text: z.string(),
  parentToolUseId: ParentToolUseIdSchema,
});

export const ToolUseItemSchema = z.object({
  kind: z.literal("tool_use"),
  messageId: z.string(),
  toolUseId: z.string(),
  name: z.string(),
  input: z.unknown(),
  inputTruncated: z.boolean(),
  parentToolUseId: ParentToolUseIdSchema,
});

export const ToolResultItemSchema = z.object({
  kind: z.literal("tool_result"),
  toolUseId: z.string(),
  isError: z.boolean(),
  content: z.string(),
  truncated: z.boolean(),
  parentToolUseId: ParentToolUseIdSchema,
});

export const TurnUsageItemSchema = z.object({
  kind: z.literal("turn_usage"),
  messageId: z.string(),
  model: z.string().nullable(),
  usage: TokenUsageSchema,
});

export const ResultItemSchema = z.object({
  kind: z.literal("result"),
  subtype: z.string(),
  isError: z.boolean(),
  numTurns: z.number().int().nullable(),
  durationMs: z.number().int().nullable(),
  durationApiMs: z.number().int().nullable(),
  costUsd: z.number().nullable(),
  usage: TokenUsageSchema,
  resultText: z.string().nullable(),
  sessionId: z.string().nullable(),
  modelUsage: z.record(z.string(), ModelUsageSchema),
});

export const StatusItemSchema = z.object({
  kind: z.literal("status"),
  status: RunStatusSchema,
  exitCode: z.number().int().nullable(),
  signal: z.string().nullable(),
  message: z.string().nullable(),
});

export const StderrItemSchema = z.object({
  kind: z.literal("stderr"),
  text: z.string(),
});

export const UnknownItemSchema = z.object({
  kind: z.literal("unknown"),
  type: z.string(),
});

export const RunItemSchema = z.discriminatedUnion("kind", [
  InitItemSchema,
  SystemItemSchema,
  PromptItemSchema,
  UserTextItemSchema,
  TextItemSchema,
  ThinkingItemSchema,
  ToolUseItemSchema,
  ToolResultItemSchema,
  TurnUsageItemSchema,
  ResultItemSchema,
  StatusItemSchema,
  StderrItemSchema,
  UnknownItemSchema,
]);
export type RunItem = z.infer<typeof RunItemSchema>;
export type RunItemKind = RunItem["kind"];
export type RunItemOf<K extends RunItemKind> = Extract<RunItem, { kind: K }>;

export const OnyxRunItemSchema = z.discriminatedUnion("kind", [
  PromptItemSchema,
  StatusItemSchema,
  StderrItemSchema,
]);
export type OnyxRunItem = z.infer<typeof OnyxRunItemSchema>;

export const StoredItemsPayloadSchema = z.object({
  items: z.array(RunItemSchema),
});
export type StoredItemsPayload = z.infer<typeof StoredItemsPayloadSchema>;
