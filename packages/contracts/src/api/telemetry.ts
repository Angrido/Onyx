import { z } from "zod";
import { TokenUsageSchema } from "../domain";

export const UsageWindowSchema = z.object({
  runs: z.number().int(),
  costUsd: z.number(),
  usage: TokenUsageSchema,
  cacheHitRatio: z.number(),
});
export type UsageWindow = z.infer<typeof UsageWindowSchema>;

export const ModelSpendSchema = z.object({
  modelId: z.string(),
  runs: z.number().int(),
  costUsd: z.number(),
  usage: TokenUsageSchema,
});
export type ModelSpend = z.infer<typeof ModelSpendSchema>;

export const TelemetrySummarySchema = z.object({
  activeRuns: z.number().int(),
  queuedTasks: z.number().int(),
  today: UsageWindowSchema,
  last7Days: UsageWindowSchema,
  byModel: z.array(ModelSpendSchema),
});
export type TelemetrySummary = z.infer<typeof TelemetrySummarySchema>;

export const HealthResponseSchema = z.object({
  status: z.literal("ok"),
  uptimeSec: z.number(),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

export const ReadinessCheckSchema = z.object({
  name: z.string(),
  ok: z.boolean(),
  detail: z.string().nullable(),
});

export const ReadyResponseSchema = z.object({
  ready: z.boolean(),
  checks: z.array(ReadinessCheckSchema),
  cliVersion: z.string().nullable(),
});
export type ReadyResponse = z.infer<typeof ReadyResponseSchema>;
