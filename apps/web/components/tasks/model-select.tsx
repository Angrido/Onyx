"use client";

import type { ModelProfileDto } from "@onyx/contracts";
import { Select } from "@/components/ui/form-controls";
import { TIER_STYLES } from "@/lib/tiers";

export function ModelSelect({
  id,
  models,
  value,
  onChange,
  defaultLabel,
}: {
  id: string;
  models: ModelProfileDto[];
  value: string;
  onChange: (value: string) => void;
  defaultLabel: string;
}) {
  return (
    <Select id={id} value={value} onChange={(event) => onChange(event.target.value)}>
      <option value="">{defaultLabel}</option>
      {models
        .filter((model) => model.enabled)
        .map((model) => (
          <option key={model.id} value={model.id}>
            {`${model.displayName} · ${TIER_STYLES[model.tier].label} · $${model.inputUsdPerMTok}/$${model.outputUsdPerMTok} per MTok`}
          </option>
        ))}
    </Select>
  );
}
