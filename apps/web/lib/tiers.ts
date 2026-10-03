import type { ModelTier } from "@onyx/contracts";

export interface TierStyle {
  label: string;
  text: string;
  bg: string;
  border: string;
  glow: string;
  color: string;
}

export const TIER_STYLES: Record<ModelTier, TierStyle> = {
  ARCHITECT: {
    label: "Architect",
    text: "text-architect",
    bg: "bg-architect/12",
    border: "border-architect/35",
    glow: "shadow-[0_0_24px_-6px_var(--tier-architect)]",
    color: "var(--tier-architect)",
  },
  BUILDER: {
    label: "Builder",
    text: "text-builder",
    bg: "bg-builder/12",
    border: "border-builder/35",
    glow: "shadow-[0_0_24px_-6px_var(--tier-builder)]",
    color: "var(--tier-builder)",
  },
  SCOUT: {
    label: "Scout",
    text: "text-scout",
    bg: "bg-scout/12",
    border: "border-scout/35",
    glow: "shadow-[0_0_24px_-6px_var(--tier-scout)]",
    color: "var(--tier-scout)",
  },
  APEX: {
    label: "Apex",
    text: "text-apex",
    bg: "bg-apex/12",
    border: "border-apex/35",
    glow: "shadow-[0_0_24px_-6px_var(--tier-apex)]",
    color: "var(--tier-apex)",
  },
};

export function tierOfModel(modelId: string): ModelTier {
  if (modelId.includes("opus")) return "ARCHITECT";
  if (modelId.includes("haiku")) return "SCOUT";
  if (modelId.includes("fable") || modelId.includes("mythos")) return "APEX";
  return "BUILDER";
}

export function modelLabel(modelId: string): string {
  return modelId
    .replace(/^claude-/, "")
    .split("-")
    .map((part, index) => (index === 0 ? part.charAt(0).toUpperCase() + part.slice(1) : part))
    .join(" ")
    .replace(/ (\d+) (\d+)$/, " $1.$2");
}
