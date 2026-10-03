import { z } from "zod";
import { ModelTierSchema, PermissionModeSchema } from "../domain";

export const ModelProfileDtoSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  alias: z.string(),
  tier: ModelTierSchema,
  contextWindow: z.number().int(),
  inputUsdPerMTok: z.number(),
  outputUsdPerMTok: z.number(),
  enabled: z.boolean(),
});
export type ModelProfileDto = z.infer<typeof ModelProfileDtoSchema>;

export const AgentConfigDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  tier: ModelTierSchema,
  modelId: z.string(),
  permissionMode: PermissionModeSchema,
  maxTurns: z.number().int(),
  isBuiltin: z.boolean(),
});
export type AgentConfigDto = z.infer<typeof AgentConfigDtoSchema>;

export const CatalogResponseSchema = z.object({
  models: z.array(ModelProfileDtoSchema),
  agentConfigs: z.array(AgentConfigDtoSchema),
});
export type CatalogResponse = z.infer<typeof CatalogResponseSchema>;
