"use client";

import type { RouterSettings, RouterSettingsDto, RouterWeights } from "@onyx/contracts";
import { MODEL_TIERS } from "@onyx/contracts/client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Save, SlidersHorizontal } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ScoreBar } from "@/components/router/score-bar";
import { ModelBadge } from "@/components/tasks/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/form-controls";
import { HelpTip } from "@/components/ui/help-tip";
import { api, errorMessage } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/keys";
import { formatPercent } from "@/lib/format";
import { useT } from "@/lib/i18n/client";
import { WEIGHT_KEYS, WEIGHT_LABELS, weightSum } from "@/lib/router";
import { TIER_STYLES, modelLabel } from "@/lib/tiers";

function Slider({
  id,
  label,
  hint,
  value,
  onChange,
}: {
  id: string;
  label: string;
  hint?: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-3">
        <Label htmlFor={id} className="normal-case tracking-normal text-foreground">
          {label}
        </Label>
        <span className="tabular text-xs text-muted-foreground">{value.toFixed(2)}</span>
      </div>
      <input
        id={id}
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full accent-[var(--primary)]"
      />
      {hint ? <p className="text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function sameSettings(a: RouterSettings, b: RouterSettings): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function pick(settings: RouterSettingsDto): RouterSettings {
  return {
    weights: settings.weights,
    thresholds: settings.thresholds,
    classifierConfidence: settings.classifierConfidence,
    autoEscalate: settings.autoEscalate,
  };
}

export function RouterSettingsForm({ settings }: { settings: RouterSettingsDto }) {
  const t = useT();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<RouterSettings>(() => pick(settings));
  const saved = pick(settings);
  const dirty = !sameSettings(draft, saved);
  const thresholdsValid = draft.thresholds.builder < draft.thresholds.architect;

  const save = useMutation({
    mutationFn: () => api.put<RouterSettingsDto>("/api/router/settings", draft),
    onSuccess: (updated) => {
      queryClient.setQueryData(queryKeys.routerSettings, updated);
      setDraft(pick(updated));
      toast.success(t("Router settings saved"));
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const setWeight = (key: keyof RouterWeights, value: number) =>
    setDraft((current) => ({ ...current, weights: { ...current.weights, [key]: value } }));

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SlidersHorizontal className="size-4 text-primary" />
          {t("Heuristic")}
        </CardTitle>
        <CardDescription>
          {t(
            "Used when no rule matches. Each signal is normalised to 0–1 and weighted; the score picks the tier.",
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-3">
          {WEIGHT_KEYS.map((key) => (
            <Slider
              key={key}
              id={`weight-${key}`}
              label={t(WEIGHT_LABELS[key].label)}
              hint={t(WEIGHT_LABELS[key].hint)}
              value={draft.weights[key]}
              onChange={(value) => setWeight(key, value)}
            />
          ))}
          <p className="text-xs text-muted-foreground">
            {t("Maximum score {score}", { score: weightSum(draft.weights).toFixed(2) })}
          </p>
        </div>
        <div className="space-y-3 rounded-lg border border-border bg-surface-0/60 p-3">
          <Slider
            id="threshold-builder"
            label={t("Builder from")}
            value={draft.thresholds.builder}
            onChange={(value) =>
              setDraft((current) => ({
                ...current,
                thresholds: { ...current.thresholds, builder: value },
              }))
            }
          />
          <Slider
            id="threshold-architect"
            label={t("Architect from")}
            value={draft.thresholds.architect}
            onChange={(value) =>
              setDraft((current) => ({
                ...current,
                thresholds: { ...current.thresholds, architect: value },
              }))
            }
          />
          <ScoreBar
            score={null}
            max={Math.max(weightSum(draft.weights), draft.thresholds.architect, 0.05)}
            thresholds={draft.thresholds}
            tier="BUILDER"
          />
          {!thresholdsValid ? (
            <p className="text-xs text-destructive">
              {t("The builder threshold must be lower than the architect threshold.")}
            </p>
          ) : null}
          <p className="text-[11px] text-muted-foreground">
            {t(
              "Below the builder threshold, docs and chores go to Scout; everything else stays on Builder.",
            )}
          </p>
        </div>
        <div className="space-y-3">
          <Slider
            id="classifier-confidence"
            label={t("Ask the classifier below")}
            hint={
              settings.classifierAvailable
                ? t("Heuristic confidence under {percent} goes to {model}.", {
                    percent: formatPercent(draft.classifierConfidence),
                    model: settings.classifierModelId
                      ? modelLabel(settings.classifierModelId)
                      : t("the classifier"),
                  })
                : t("The classifier needs an API key; without it the heuristic decides alone.")
            }
            value={draft.classifierConfidence}
            onChange={(value) =>
              setDraft((current) => ({ ...current, classifierConfidence: value }))
            }
          />
          <label className="flex items-center gap-3 text-sm">
            <input
              type="checkbox"
              className="size-4 accent-[var(--primary)]"
              checked={draft.autoEscalate}
              onChange={(event) =>
                setDraft((current) => ({ ...current, autoEscalate: event.target.checked }))
              }
            />
            {t("Re-queue on the next tier after")}{" "}
            <code className="font-mono text-xs">error_max_turns</code>
          </label>
        </div>
        <div className="space-y-2">
          <p className="flex items-center gap-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            {t("Tier models")}
            <HelpTip term="tier" />
          </p>
          <div className="flex flex-wrap gap-2">
            {MODEL_TIERS.map((tier) => {
              const modelId = settings.tierModels[tier];
              return (
                <span key={tier} className="flex items-center gap-1.5 text-xs">
                  <span className={TIER_STYLES[tier].text}>{t(TIER_STYLES[tier].label)}</span>
                  {modelId ? <ModelBadge modelId={modelId} /> : <Badge>{t("none enabled")}</Badge>}
                </span>
              );
            })}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            onClick={() => save.mutate()}
            disabled={!dirty || !thresholdsValid || save.isPending}
          >
            {save.isPending ? <Loader2 className="animate-spin" /> : <Save />}
            {t("Save")}
          </Button>
          {dirty ? (
            <Button variant="ghost" onClick={() => setDraft(saved)}>
              {t("Discard")}
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
