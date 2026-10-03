import { z } from "zod";
import {
  ModelTierSchema,
  RoutingStrategySchema,
  RunModeSchema,
  RunStatusSchema,
  TokenUsageSchema,
} from "../domain";
import { RunItemSchema } from "../stream-json/run-items";

export const RunContextDtoSchema = z.object({
  baselineTokens: z.number().int().nullable(),
  deliveredTokens: z.number().int().nullable(),
  expansions: z.number().int(),
});
export type RunContextDto = z.infer<typeof RunContextDtoSchema>;

export const RunRoutingDtoSchema = z.object({
  strategy: RoutingStrategySchema,
  tier: ModelTierSchema,
  rationale: z.string(),
});
export type RunRoutingDto = z.infer<typeof RunRoutingDtoSchema>;

export const RunDtoSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  sessionId: z.string(),
  workspaceId: z.string(),
  modelId: z.string(),
  mode: RunModeSchema,
  status: RunStatusSchema,
  prompt: z.string(),
  exitCode: z.number().int().nullable(),
  signal: z.string().nullable(),
  resultSubtype: z.string().nullable(),
  isError: z.boolean(),
  numTurns: z.number().int().nullable(),
  durationMs: z.number().int().nullable(),
  costUsd: z.number().nullable(),
  errorMessage: z.string().nullable(),
  cliVersion: z.string().nullable(),
  usage: TokenUsageSchema,
  context: RunContextDtoSchema,
  guardDenials: z.number().int(),
  changedFiles: z.array(z.string()),
  routing: RunRoutingDtoSchema.nullable(),
  startedAt: z.string(),
  endedAt: z.string().nullable(),
});
export type RunDto = z.infer<typeof RunDtoSchema>;

export const RunEventsQuerySchema = z.object({
  after: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(1000).default(500),
});
export type RunEventsQuery = z.input<typeof RunEventsQuerySchema>;

export const RunEventPageItemSchema = z.object({
  seq: z.number().int(),
  createdAt: z.string(),
  items: z.array(RunItemSchema),
});
export type RunEventPageItem = z.infer<typeof RunEventPageItemSchema>;

export const RunEventsResponseSchema = z.object({
  items: z.array(RunEventPageItemSchema),
  nextAfter: z.number().int().nullable(),
});
export type RunEventsResponse = z.infer<typeof RunEventsResponseSchema>;

export const RunListResponseSchema = z.object({
  items: z.array(RunDtoSchema),
});
export type RunListResponse = z.infer<typeof RunListResponseSchema>;
