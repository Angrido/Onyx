import { z } from "zod";
import { DomainSchema } from "../domain";

export const RuleActionSchema = z.enum(["EXCLUDE", "INCLUDE"]);
export const RuleSourceSchema = z.enum(["MANUAL", "PRESET", "HEURISTIC", "SECURITY"]);

export const PolicyRuleSchema = z.object({
  pattern: z.string().trim().min(1).max(512),
  action: RuleActionSchema,
  source: RuleSourceSchema,
  locked: z.boolean(),
  reason: z.string().nullable(),
});
export type PolicyRuleDto = z.infer<typeof PolicyRuleSchema>;

export const PolicyRuleInputSchema = z.object({
  pattern: z.string().trim().min(1).max(512),
  action: RuleActionSchema.default("EXCLUDE"),
  source: RuleSourceSchema.exclude(["SECURITY"]).default("MANUAL"),
  reason: z.string().max(200).nullable().default(null),
});
export type PolicyRuleInput = z.input<typeof PolicyRuleInputSchema>;

export const SurgeonFileSchema = z.object({
  path: z.string(),
  kind: z.string().nullable(),
  sizeBytes: z.number().int(),
  rawTokens: z.number().int(),
  l1Tokens: z.number().int().nullable(),
  binary: z.boolean(),
  sensitive: z.boolean(),
  domain: DomainSchema.nullable(),
  centrality: z.number(),
});
export type SurgeonFile = z.infer<typeof SurgeonFileSchema>;

export const ProfileStateSchema = z.object({
  id: z.string().nullable(),
  version: z.number().int(),
  compiledHash: z.string().nullable(),
  compiledAt: z.string().nullable(),
  rules: z.array(PolicyRuleSchema),
});
export type ProfileState = z.infer<typeof ProfileStateSchema>;

export const TokenCalibrationSchema = z.object({
  reference: z.enum(["o200k_base", "anthropic"]),
  fingerprint: z.string(),
  ratios: z.record(z.string(), z.number()),
  sampleFiles: z.number().int(),
  measuredAt: z.string(),
});
export type TokenCalibration = z.infer<typeof TokenCalibrationSchema>;

export const SurgeonStateDtoSchema = z.object({
  projectId: z.string(),
  workspaceId: z.string().nullable(),
  indexedAt: z.string().nullable(),
  base: ProfileStateSchema,
  overlay: ProfileStateSchema.nullable(),
  securityRules: z.array(PolicyRuleSchema),
  files: z.array(SurgeonFileSchema),
  pricing: z.object({ modelId: z.string(), inputUsdPerMTok: z.number() }).nullable(),
  calibration: TokenCalibrationSchema.nullable(),
  claudesignorePath: z.string(),
  claudesignoreExists: z.boolean(),
});
export type SurgeonStateDto = z.infer<typeof SurgeonStateDtoSchema>;

export const SurgeonScopeQuerySchema = z.object({
  workspaceId: z.string().min(1).max(64).optional(),
});
export type SurgeonScopeQuery = z.input<typeof SurgeonScopeQuerySchema>;

export const SaveProfileRequestSchema = z.object({
  workspaceId: z.string().min(1).max(64).nullable().default(null),
  rules: z.array(PolicyRuleInputSchema).max(2_000),
});
export type SaveProfileRequest = z.input<typeof SaveProfileRequestSchema>;

export const SuggestionDtoSchema = z.object({
  rule: PolicyRuleSchema,
  files: z.number().int(),
  tokens: z.number().int(),
  centralFiles: z.array(z.string()),
});
export type SuggestionDto = z.infer<typeof SuggestionDtoSchema>;

export const SuggestResponseSchema = z.object({ items: z.array(SuggestionDtoSchema) });
export type SuggestResponse = z.infer<typeof SuggestResponseSchema>;

export const CompiledPolicyDtoSchema = z.object({
  mode: z.enum(["pass-through", "materialized"]),
  hash: z.string(),
  readDeny: z.array(z.string()),
  editDeny: z.array(z.string()),
  truncated: z.boolean(),
  claudesignore: z.string(),
  excludedFiles: z.number().int(),
  excludedTokens: z.number().int(),
});
export type CompiledPolicyDto = z.infer<typeof CompiledPolicyDtoSchema>;

export const MeasureResponseSchema = z.object({
  reference: z.enum(["o200k_base", "anthropic"]),
  excludedFiles: z.number().int(),
  sampledFiles: z.number().int(),
  estimatedTokens: z.number().int(),
  measuredTokens: z.number().int(),
  error: z.number(),
  calibrated: z.boolean(),
});
export type MeasureResponse = z.infer<typeof MeasureResponseSchema>;

export const ExportResponseSchema = z.object({ path: z.string(), rules: z.number().int() });
export type ExportResponse = z.infer<typeof ExportResponseSchema>;

export const HookInputSchema = z.looseObject({
  hook_event_name: z.string(),
  tool_name: z.string().default(""),
  tool_input: z.unknown().optional(),
  tool_use_id: z.string().optional(),
  cwd: z.string().optional(),
  session_id: z.string().optional(),
});
export type HookInput = z.infer<typeof HookInputSchema>;
