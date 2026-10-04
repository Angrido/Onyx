import { z } from "zod";
import {
  ContextArmSchema,
  ModelTierSchema,
  RoutingStrategySchema,
  RunStatusSchema,
  SessionEndReasonSchema,
  TokenUsageSchema,
} from "../domain";

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
  parentToolUseId: ParentToolUseIdSchema.default(null),
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
  structuredOutput: z.unknown().optional(),
  errors: z.array(z.string()).optional(),
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
  reused: z.boolean().default(false),
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
  reusedTokens: z.number().int().default(0),
  mapFrozen: z.boolean().default(false),
  indexedAt: z.string().nullable(),
  mcpEnabled: z.boolean(),
  note: z.string().nullable(),
  arm: ContextArmSchema.nullable().default(null),
});
export type ContextItem = z.infer<typeof ContextItemSchema>;

export const GuardSourceSchema = z.enum(["hook", "permission", "audit"]);
export type GuardSource = z.infer<typeof GuardSourceSchema>;

export const GuardItemSchema = z.object({
  kind: z.literal("guard"),
  source: GuardSourceSchema,
  tool: z.string(),
  toolUseId: z.string().nullable().default(null),
  target: z.string().nullable(),
  rule: z.string().nullable(),
  reason: z.string().nullable(),
});
export type GuardItem = z.infer<typeof GuardItemSchema>;

export const RoutingItemSchema = z.object({
  kind: z.literal("routing"),
  strategy: RoutingStrategySchema,
  tier: ModelTierSchema,
  modelId: z.string(),
  rationale: z.string(),
  score: z.number().nullable(),
  confidence: z.number().nullable(),
  ruleName: z.string().nullable(),
});
export type RoutingItem = z.infer<typeof RoutingItemSchema>;

export const SessionActionSchema = z.enum(["resumed", "started"]);
export type SessionAction = z.infer<typeof SessionActionSchema>;

export const SessionItemSchema = z.object({
  kind: z.literal("session"),
  action: SessionActionSchema,
  sessionId: z.string(),
  workspaceName: z.string(),
  reason: SessionEndReasonSchema.nullable(),
  previousSessionId: z.string().nullable(),
  handoff: z.object({ text: z.string(), tokens: z.number().int() }).nullable(),
  contextTokens: z.number().int(),
  maxSessionTokens: z.number().int(),
});
export type SessionItem = z.infer<typeof SessionItemSchema>;

export const RateLimitItemSchema = z.object({
  kind: z.literal("rate_limit"),
  status: z.string(),
  limitType: z.string().nullable(),
  resetsAt: z.string().nullable(),
  utilization: z.number().nullable(),
  overageStatus: z.string().nullable(),
  usingOverage: z.boolean(),
});
export type RateLimitItem = z.infer<typeof RateLimitItemSchema>;

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
  GuardItemSchema,
  RoutingItemSchema,
  SessionItemSchema,
  RateLimitItemSchema,
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
  GuardItemSchema,
  RoutingItemSchema,
  SessionItemSchema,
]);
export type OnyxRunItem = z.infer<typeof OnyxRunItemSchema>;

export const StoredItemsPayloadSchema = z.object({
  items: z.array(RunItemSchema),
});
export type StoredItemsPayload = z.infer<typeof StoredItemsPayloadSchema>;
