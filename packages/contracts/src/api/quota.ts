import { z } from "zod";
import { QUOTA_LEVELS } from "../client";

export const QuotaLevelSchema = z.enum(QUOTA_LEVELS);
export type QuotaLevel = z.infer<typeof QuotaLevelSchema>;

export const QuotaWindowDtoSchema = z.object({
  type: z.string(),
  status: z.string(),
  utilization: z.number().nullable(),
  resetsAt: z.string().nullable(),
  observedAt: z.string(),
  stale: z.boolean(),
});
export type QuotaWindowDto = z.infer<typeof QuotaWindowDtoSchema>;

export const QuotaSettingsSchema = z
  .object({
    warnAt: z.number().min(0.5).max(0.99),
    holdAt: z.number().min(0.5).max(1),
    deferEnabled: z.boolean(),
  })
  .refine((settings) => settings.holdAt >= settings.warnAt, {
    message: "The hold threshold must not be below the warning threshold",
    path: ["holdAt"],
  });
export type QuotaSettings = z.infer<typeof QuotaSettingsSchema>;

export const QuotaDtoSchema = z.object({
  level: QuotaLevelSchema,
  windows: z.array(QuotaWindowDtoSchema),
  settings: QuotaSettingsSchema,
  deferredTasks: z.number().int(),
  nextResetAt: z.string().nullable(),
  message: z.string(),
});
export type QuotaDto = z.infer<typeof QuotaDtoSchema>;
