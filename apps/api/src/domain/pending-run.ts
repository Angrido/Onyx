import { MODEL_TIERS, type ModelTier } from "@onyx/contracts";

export type PendingRun = {
  prompt: string | null;
  modelId: string | null;
  agentConfigId: string | null;
  newSession: boolean;
  tierHint: { tier: ModelTier; reason: string } | null;
};

export interface PendingRunSource {
  prompt: string | null;
  modelId: string | null;
  agentConfigId: string | null;
  newSession: boolean;
  tierHint?: { tier: ModelTier; reason: string } | null;
}

export function pendingRunOf(request: PendingRunSource): PendingRun {
  return {
    prompt: request.prompt,
    modelId: request.modelId,
    agentConfigId: request.agentConfigId,
    newSession: request.newSession,
    tierHint: request.tierHint
      ? { tier: request.tierHint.tier, reason: request.tierHint.reason }
      : null,
  };
}

function optionalText(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function isTier(value: unknown): value is ModelTier {
  return typeof value === "string" && (MODEL_TIERS as readonly string[]).includes(value);
}

export function readPendingRun(value: unknown): PendingRun | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const hint = record["tierHint"];
  const hintRecord =
    typeof hint === "object" && hint !== null && !Array.isArray(hint)
      ? (hint as Record<string, unknown>)
      : null;
  return {
    prompt: optionalText(record["prompt"]),
    modelId: optionalText(record["modelId"]),
    agentConfigId: optionalText(record["agentConfigId"]),
    newSession: record["newSession"] === true,
    tierHint:
      hintRecord && isTier(hintRecord["tier"]) && typeof hintRecord["reason"] === "string"
        ? { tier: hintRecord["tier"], reason: hintRecord["reason"] }
        : null,
  };
}
