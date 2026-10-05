import { z } from "zod";
import { EXPERIMENT_STATES, MEMORY_ARMS, MEMORY_FACT_KINDS, MEMORY_FACT_STATUSES } from "../client";
import { IsoDateSchema } from "./common";

export const MemoryFactKindSchema = z.enum(MEMORY_FACT_KINDS);
export type MemoryFactKind = z.infer<typeof MemoryFactKindSchema>;

export const MemoryFactStatusSchema = z.enum(MEMORY_FACT_STATUSES);
export type MemoryFactStatus = z.infer<typeof MemoryFactStatusSchema>;

export const MemoryArmSchema = z.enum(MEMORY_ARMS);
export type MemoryArm = z.infer<typeof MemoryArmSchema>;

export const MemoryFactDtoSchema = z.object({
  id: z.string(),
  kind: MemoryFactKindSchema,
  status: MemoryFactStatusSchema,
  subject: z.string(),
  detail: z.string().nullable(),
  text: z.string().nullable(),
  line: z.string(),
  evidence: z.number().int(),
  pinned: z.boolean(),
  sourceRunId: z.string().nullable(),
  sourceTaskTitle: z.string().nullable(),
  sourcePath: z.string().nullable(),
  firstSeenAt: IsoDateSchema,
  lastSeenAt: IsoDateSchema,
  expiresAt: IsoDateSchema.nullable(),
  included: z.boolean(),
});
export type MemoryFactDto = z.infer<typeof MemoryFactDtoSchema>;

export const MemorySettingsSchema = z.object({
  enabled: z.boolean(),
  budgetTokens: z.number().int().min(200).max(4000),
  expiryDays: z.number().int().min(7).max(365),
  experiment: z.boolean(),
});
export type MemorySettings = z.infer<typeof MemorySettingsSchema>;

export const MemoryArmStatsSchema = z.object({
  arm: MemoryArmSchema,
  runs: z.number().int(),
  completed: z.number().int(),
  successRate: z.number().nullable(),
  medianContextTokens: z.number().nullable(),
  medianReadFiles: z.number().nullable(),
  medianTurns: z.number().nullable(),
});
export type MemoryArmStats = z.infer<typeof MemoryArmStatsSchema>;

export const MemoryExperimentSchema = z.object({
  state: z.enum(EXPERIMENT_STATES),
  windowDays: z.number().int(),
  minRunsPerArm: z.number().int(),
  withMemory: MemoryArmStatsSchema,
  without: MemoryArmStatsSchema,
  tokenChange: z.number().nullable(),
  readFilesChange: z.number().nullable(),
  turnsChange: z.number().nullable(),
  pValue: z.number().nullable(),
  successGap: z.number().nullable(),
});
export type MemoryExperiment = z.infer<typeof MemoryExperimentSchema>;

export const MemoryPreviewSchema = z.object({
  text: z.string(),
  tokens: z.number().int(),
  included: z.number().int(),
  omitted: z.number().int(),
});
export type MemoryPreview = z.infer<typeof MemoryPreviewSchema>;

export const ProjectMemoryDtoSchema = z.object({
  projectId: z.string(),
  facts: z.array(MemoryFactDtoSchema),
  preview: MemoryPreviewSchema.nullable(),
  settings: MemorySettingsSchema,
});
export type ProjectMemoryDto = z.infer<typeof ProjectMemoryDtoSchema>;

export const UpdateMemoryFactRequestSchema = z
  .object({
    status: z.enum(["ACTIVE", "DISMISSED"]).optional(),
    pinned: z.boolean().optional(),
    text: z.string().trim().min(1).max(300).nullable().optional(),
  })
  .refine(
    (input) => input.status !== undefined || input.pinned !== undefined || input.text !== undefined,
    { message: "Nothing to change" },
  );
export type UpdateMemoryFactRequest = z.input<typeof UpdateMemoryFactRequestSchema>;

export const CreateMemoryNoteRequestSchema = z.object({
  text: z.string().trim().min(3).max(300),
});
export type CreateMemoryNoteRequest = z.input<typeof CreateMemoryNoteRequestSchema>;
