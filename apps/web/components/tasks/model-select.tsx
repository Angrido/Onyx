"use client";

import type { ModelProfileDto } from "@onyx/contracts";
import { Select } from "@/components/ui/form-controls";
import { useT } from "@/lib/i18n/client";
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
  const t = useT();
  return (
    <Select id={id} value={value} onChange={(event) => onChange(event.target.value)}>
      <option value="">{defaultLabel}</option>
      {models
        .filter((model) => model.enabled)
        .map((model) => (
          <option key={model.id} value={model.id}>
            {t("{name} · {tier} · ${input}/${output} per MTok", {
              name: model.displayName,
              tier: t(TIER_STYLES[model.tier].label),
              input: model.inputUsdPerMTok,
              output: model.outputUsdPerMTok,
            })}
          </option>
        ))}
    </Select>
  );
}
