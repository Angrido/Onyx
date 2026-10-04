import { z } from "zod";
import { SAVINGS_CHECK_STATES, SAVINGS_VERDICTS } from "../client";
import { ContextArmSchema } from "../domain";

export const MIN_CONTROL_SHARE = 0.1;
export const MAX_CONTROL_SHARE = 0.5;

export const ContextExperimentSettingsSchema = z.object({
  enabled: z.boolean(),
  controlShare: z.number().min(MIN_CONTROL_SHARE).max(MAX_CONTROL_SHARE),
});
export type ContextExperimentSettings = z.infer<typeof ContextExperimentSettingsSchema>;

export const ArmStatsSchema = z.object({
  arm: ContextArmSchema,
  runs: z.number().int(),
  completed: z.number().int(),
  successRate: z.number().nullable(),
  medianContextTokens: z.number().nullable(),
  medianOutputTokens: z.number().nullable(),
  medianCostUsd: z.number().nullable(),
  medianTurns: z.number().nullable(),
  medianReadFiles: z.number().nullable(),
  totalCostUsd: z.number(),
});
export type ArmStats = z.infer<typeof ArmStatsSchema>;

export const ExperimentStateSchema = z.enum([
  "OFF",
  "COLLECTING",
  "SAVING",
  "NO_DIFFERENCE",
  "COSTS_MORE",
]);
export type ExperimentState = z.infer<typeof ExperimentStateSchema>;

export const ExperimentResultSchema = z.object({
  settings: ContextExperimentSettingsSchema,
  state: ExperimentStateSchema,
  windowDays: z.number().int(),
  minRunsPerArm: z.number().int(),
  since: z.string().nullable(),
  pack: ArmStatsSchema,
  control: ArmStatsSchema,
  tokenChange: z.number().nullable(),
  costChange: z.number().nullable(),
  pValue: z.number().nullable(),
  successGap: z.number().nullable(),
});
export type ExperimentResult = z.infer<typeof ExperimentResultSchema>;

export const RereadFileSchema = z.object({
  relPath: z.string(),
  runs: z.number().int(),
});
export type RereadFile = z.infer<typeof RereadFileSchema>;

export const PackAccountingSchema = z.object({
  windowDays: z.number().int(),
  runs: z.number().int(),
  runsWithPack: z.number().int(),
  controlRuns: z.number().int(),
  baselineTokens: z.number().int(),
  deliveredTokens: z.number().int(),
  rereadTokens: z.number().int(),
  grossSaving: z.number().nullable(),
  netSaving: z.number().nullable(),
  runsWithRereads: z.number().int(),
  rereadFiles: z.number().int(),
  readFiles: z.number().int(),
  missedFiles: z.number().int(),
  expansions: z.number().int(),
  topRereads: z.array(RereadFileSchema),
});
export type PackAccounting = z.infer<typeof PackAccountingSchema>;

export const SavingsCheckStateSchema = z.enum(SAVINGS_CHECK_STATES);
export type SavingsCheckState = z.infer<typeof SavingsCheckStateSchema>;

export const SavingsCheckSchema = z.object({
  id: z.string(),
  state: SavingsCheckStateSchema,
  title: z.string(),
  detail: z.string(),
});
export type SavingsCheck = z.infer<typeof SavingsCheckSchema>;

export const OtherSavingsSchema = z.object({
  windowDays: z.number().int(),
  cacheReadTokens: z.number().int(),
  cacheSavedUsd: z.number(),
  routingReferenceModelId: z.string().nullable(),
  routingSavedUsd: z.number().nullable(),
  routingSavingRatio: z.number().nullable(),
});
export type OtherSavings = z.infer<typeof OtherSavingsSchema>;

export const SavingsVerdictStateSchema = z.enum(SAVINGS_VERDICTS);
export type SavingsVerdictState = z.infer<typeof SavingsVerdictStateSchema>;

export const SavingsVerdictSchema = z.object({
  state: SavingsVerdictStateSchema,
  headline: z.string(),
  detail: z.string(),
});
export type SavingsVerdict = z.infer<typeof SavingsVerdictSchema>;

export const SavingsReportSchema = z.object({
  generatedAt: z.string(),
  contextEnabled: z.boolean(),
  verdict: SavingsVerdictSchema,
  experiment: ExperimentResultSchema,
  pack: PackAccountingSchema,
  checks: z.array(SavingsCheckSchema),
  other: OtherSavingsSchema,
});
export type SavingsReport = z.infer<typeof SavingsReportSchema>;
