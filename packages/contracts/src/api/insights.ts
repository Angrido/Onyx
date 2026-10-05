import { z } from "zod";
import {
  FINDING_CATEGORIES,
  FINDING_SEVERITIES,
  FINDING_STATES,
  FINDING_VERDICTS,
  IDEATION_STATUSES,
  INSIGHT_INTENTS,
  INSIGHT_MODES,
} from "../client";

export const InsightModeSchema = z.enum(INSIGHT_MODES);
export type InsightMode = z.infer<typeof InsightModeSchema>;
export const InsightIntentSchema = z.enum(INSIGHT_INTENTS);
export type InsightIntent = z.infer<typeof InsightIntentSchema>;

export const InsightSourceSchema = z.object({
  path: z.string(),
  line: z.number().int().nullable(),
});
export type InsightSource = z.infer<typeof InsightSourceSchema>;

export const InsightDtoSchema = z.object({
  id: z.string(),
  question: z.string(),
  intent: InsightIntentSchema,
  mode: InsightModeSchema,
  answer: z.string(),
  sources: z.array(InsightSourceSchema),
  modelId: z.string().nullable(),
  costUsd: z.number().nullable(),
  tokens: z.number().int().nullable(),
  createdAt: z.string(),
});
export type InsightDto = z.infer<typeof InsightDtoSchema>;

export const AskInsightRequestSchema = z.object({
  question: z.string().trim().min(3).max(500),
  useModel: z.boolean().default(false),
});
export type AskInsightRequest = z.input<typeof AskInsightRequestSchema>;

export const InsightListResponseSchema = z.object({
  items: z.array(InsightDtoSchema),
  indexAnswers: z.number().int(),
  modelAnswers: z.number().int(),
  indexed: z.boolean(),
});
export type InsightListResponse = z.infer<typeof InsightListResponseSchema>;

export const IdeationStatusSchema = z.enum(IDEATION_STATUSES);
export type IdeationStatus = z.infer<typeof IdeationStatusSchema>;
export const FindingCategorySchema = z.enum(FINDING_CATEGORIES);
export type FindingCategory = z.infer<typeof FindingCategorySchema>;
export const FindingSeveritySchema = z.enum(FINDING_SEVERITIES);
export type FindingSeverity = z.infer<typeof FindingSeveritySchema>;
export const FindingStateSchema = z.enum(FINDING_STATES);
export type FindingState = z.infer<typeof FindingStateSchema>;
export const FindingVerdictSchema = z.enum(FINDING_VERDICTS);
export type FindingVerdict = z.infer<typeof FindingVerdictSchema>;

export const IdeationFindingDtoSchema = z.object({
  id: z.string(),
  category: FindingCategorySchema,
  severity: FindingSeveritySchema,
  rule: z.string(),
  title: z.string(),
  file: z.string().nullable(),
  line: z.number().int().nullable(),
  excerpt: z.string().nullable(),
  explanation: z.string(),
  confidence: z.number(),
  source: z.string(),
  verdict: FindingVerdictSchema.nullable(),
  fix: z.string().nullable(),
  state: FindingStateSchema,
  taskId: z.string().nullable(),
});
export type IdeationFindingDto = z.infer<typeof IdeationFindingDtoSchema>;

export const IdeationRunDtoSchema = z.object({
  id: z.string(),
  status: IdeationStatusSchema,
  files: z.number().int(),
  audit: z.string().nullable(),
  projectTokens: z.number().int().nullable(),
  snippetTokens: z.number().int().nullable(),
  modelTokens: z.number().int().nullable(),
  modelCostUsd: z.number().nullable(),
  reviewedAt: z.string().nullable(),
  message: z.string().nullable(),
  createdAt: z.string(),
  endedAt: z.string().nullable(),
});
export type IdeationRunDto = z.infer<typeof IdeationRunDtoSchema>;

export const IdeationDtoSchema = z.object({
  run: IdeationRunDtoSchema.nullable(),
  findings: z.array(IdeationFindingDtoSchema),
  reviewable: z.number().int(),
});
export type IdeationDto = z.infer<typeof IdeationDtoSchema>;

export const FindingTaskRequestSchema = z.object({
  workspaceId: z.string().min(1).optional(),
});
export type FindingTaskRequest = z.input<typeof FindingTaskRequestSchema>;
