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

export const ContextRoleSchema = z.enum(["target", "dependency", "dependent", "nearby"]);
export type ContextRole = z.infer<typeof ContextRoleSchema>;

export const ContextLevelSchema = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]);
export type ContextLevel = z.infer<typeof ContextLevelSchema>;

export const ContextEntrySchema = z.object({
  relPath: z.string(),
  role: ContextRoleSchema,
  level: ContextLevelSchema,
  tokens: z.number().int(),
  symbols: z.array(z.string()).nullable(),
});
export type ContextEntry = z.infer<typeof ContextEntrySchema>;

export const ContextItemSchema = z.object({
  kind: z.literal("context"),
  targets: z.array(z.string()),
  inferredTargets: z.array(z.string()),
  entries: z.array(ContextEntrySchema),
  mapTokens: z.number().int(),
  packTokens: z.number().int(),
  baselineTokens: z.number().int(),
  deliveredTokens: z.number().int(),
  indexedAt: z.string().nullable(),
  mcpEnabled: z.boolean(),
  note: z.string().nullable(),
});
export type ContextItem = z.infer<typeof ContextItemSchema>;

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
  ContextItemSchema,
  UnknownItemSchema,
]);
export type RunItem = z.infer<typeof RunItemSchema>;
export type RunItemKind = RunItem["kind"];
export type RunItemOf<K extends RunItemKind> = Extract<RunItem, { kind: K }>;

export const OnyxRunItemSchema = z.discriminatedUnion("kind", [
  PromptItemSchema,
  StatusItemSchema,
  StderrItemSchema,
  ContextItemSchema,
]);
export type OnyxRunItem = z.infer<typeof OnyxRunItemSchema>;

export const StoredItemsPayloadSchema = z.object({
  items: z.array(RunItemSchema),
});
export type StoredItemsPayload = z.infer<typeof StoredItemsPayloadSchema>;
