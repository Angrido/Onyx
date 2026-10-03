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

export const NetworkAddressSchema = z.object({
  interface: z.string(),
  address: z.string(),
  family: z.enum(["IPv4", "IPv6"]),
});
export type NetworkAddress = z.infer<typeof NetworkAddressSchema>;

export const NetworkInfoSchema = z.object({
  hostname: z.string(),
  mdnsName: z.string(),
  currentOrigin: z.string().nullable(),
  addresses: z.array(NetworkAddressSchema),
  urls: z.array(z.string()),
});
export type NetworkInfo = z.infer<typeof NetworkInfoSchema>;
