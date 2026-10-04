"use client";

import type {
  ArmStats,
  CacheReport,
  ContextExperimentSettings,
  ExperimentResult,
  MemoryArmStats,
  MemoryExperiment,
  OtherSavings,
  PackAccounting,
  SavingsCheck,
  SavingsLedgerRow,
  SavingsReport,
} from "@onyx/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Calculator,
  CheckCircle2,
  CircleDashed,
  DatabaseZap,
  FlaskConical,
  Gauge,
  Loader2,
  OctagonX,
  Repeat2,
  Route,
  Scale,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/form-controls";
import { RelativeTime } from "@/components/ui/relative-time";
import { api, errorMessage } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/keys";
import { formatPercent, formatTokens, formatUsd } from "@/lib/format";
import { useT } from "@/lib/i18n/client";
import { msg, type Translate } from "@/lib/i18n/core";
import { useLiveSystem } from "@/lib/live";
import {
  accountingBars,
  armProgress,
  CACHE_LOSS_HINTS,
  CACHE_LOSS_LABELS,
  CHECK_TONES,
  CONTROL_SHARES,
  formatChange,
  formatPValue,
  savingText,
  SOURCE_LABELS,
  VERDICT_STYLES,
  type Evidence,
  type SavingsTone,
} from "@/lib/savings";
import { modelLabel } from "@/lib/tiers";
import { cn } from "@/lib/utils";

const TONE_TEXT: Record<SavingsTone, string> = {
  success: "text-success",
  warning: "text-warning",
  danger: "text-destructive",
  primary: "text-primary",
  neutral: "text-muted-foreground",
};

const TONE_SURFACE: Record<SavingsTone, string> = {
  success: "bg-success/12",
  warning: "bg-warning/12",
  danger: "bg-destructive/12",
  primary: "bg-primary/12",
  neutral: "bg-surface-2",
};

const VERDICT_ICONS: Record<SavingsReport["verdict"]["state"], LucideIcon> = {
  CONFIRMED: CheckCircle2,
  NOT_PAYING: OctagonX,
  NO_DIFFERENCE: Scale,
  COLLECTING: FlaskConical,
  ESTIMATE_ONLY: Calculator,
  NO_DATA: CircleDashed,
};

const CHECK_ICONS: Record<SavingsCheck["state"], LucideIcon> = {
  ok: CheckCircle2,
  warn: TriangleAlert,
  fail: OctagonX,
  idle: CircleDashed,
};

function runCount(count: number, t: Translate): string {
  return count === 1 ? t("1 run") : t("{count} runs", { count });
}

function EvidenceBadge({ evidence }: { evidence: Evidence }) {
  const t = useT();
  if (evidence === "none") return null;
  return evidence === "measured" ? (
    <Badge
      tone="success"
      title={t(
        "Computed from the token counts Claude reports for runs with and without the Onyx context",
      )}
    >
      <FlaskConical className="size-3" />
      {t("Measured")}
    </Badge>
  ) : (
    <Badge title={t("Computed from assumptions about what the agent would read without Onyx")}>
      <Calculator className="size-3" />
      {t("Estimate")}
    </Badge>
  );
}

function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: ReactNode;
  tone?: SavingsTone;
}) {
  return (
    <div className="min-w-0 rounded-lg border border-border bg-surface-0/60 px-3 py-2.5">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={cn("tabular text-lg font-semibold", tone ? TONE_TEXT[tone] : undefined)}>
        {value}
      </p>
      {hint ? <p className="text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function VerdictCard({ verdict }: { verdict: SavingsReport["verdict"] }) {
  const t = useT();
  const style = VERDICT_STYLES[verdict.state];
  const Icon = VERDICT_ICONS[verdict.state];
  return (
    <Card data-testid="savings-verdict" data-state={verdict.state} className="overflow-hidden">
      <CardContent className="flex flex-col gap-4 p-6 sm:flex-row sm:items-start">
        <motion.div
          initial={{ scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 320, damping: 22 }}
          className={cn(
            "grid size-12 shrink-0 place-items-center rounded-xl",
            TONE_SURFACE[style.tone],
            TONE_TEXT[style.tone],
          )}
        >
          <Icon className="size-6" />
        </motion.div>
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={style.tone}>{t(style.label)}</Badge>
            <EvidenceBadge evidence={style.evidence} />
          </div>
          <p className="text-lg font-semibold tracking-tight sm:text-xl">{verdict.headline}</p>
          <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
            {verdict.detail}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function ExperimentForm({ settings }: { settings: ContextExperimentSettings }) {
  const t = useT();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(settings);
  const dirty =
    draft.enabled !== settings.enabled ||
    draft.controlShare !== settings.controlShare ||
    draft.variant !== settings.variant;
  const save = useMutation({
    mutationFn: () =>
      api.put<ContextExperimentSettings>("/api/telemetry/savings/experiment", draft),
    onSuccess: (saved) => {
      setDraft(saved);
      void queryClient.invalidateQueries({ queryKey: queryKeys.savings });
      toast.success(saved.enabled ? t("Experiment running") : t("Experiment stopped"));
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface-0/50 p-3 sm:flex-row sm:flex-wrap sm:items-center">
      <label className="flex items-center gap-3 text-sm">
        <input
          type="checkbox"
          className="size-4 accent-[var(--primary)]"
          checked={draft.enabled}
          onChange={(event) =>
            setDraft((current) => ({ ...current, enabled: event.target.checked }))
          }
          data-testid="experiment-enabled"
        />
        {t("Run the experiment")}
      </label>
      <label className="flex items-center gap-2 text-sm text-muted-foreground sm:ml-4">
        {t("Without the context")}
        <Select
          aria-label={t("Share of runs without the context")}
          className="h-8 w-24"
          value={String(draft.controlShare)}
          onChange={(event) =>
            setDraft((current) => ({ ...current, controlShare: Number(event.target.value) }))
          }
        >
          {CONTROL_SHARES.map((share) => (
            <option key={share} value={share}>
              {formatPercent(share)}
            </option>
          ))}
        </Select>
      </label>
      <label className="flex items-center gap-2 text-sm text-muted-foreground sm:ml-4">
        {t("Variant")}
        <Select
          aria-label={t("Variant tried against the current context")}
          className="h-8 w-auto"
          value={draft.variant ?? ""}
          onChange={(event) =>
            setDraft((current) => ({
              ...current,
              variant: event.target.value === "" ? null : "TARGET_L2",
            }))
          }
          data-testid="experiment-variant"
        >
          <option value="">{t("None")}</option>
          <option value="TARGET_L2">{t("Files to edit as signatures")}</option>
        </Select>
      </label>
      <Button
        size="sm"
        className="sm:ml-auto"
        disabled={!dirty || save.isPending}
        onClick={() => save.mutate()}
        data-testid="experiment-save"
      >
        {save.isPending ? <Loader2 className="animate-spin" /> : null}
        {t("Save")}
      </Button>
    </div>
  );
}

function ArmProgress({ label, runs, min }: { label: string; runs: number; min: number }) {
  const ratio = min > 0 ? Math.min(1, runs / min) : 1;
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-[11px] text-muted-foreground">
        <span>{label}</span>
        <span className="tabular">
          {runs} / {min}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-surface-2">
        <motion.div
          className="h-full rounded-full bg-primary"
          initial={{ width: 0 }}
          animate={{ width: `${ratio * 100}%` }}
          transition={{ duration: 0.6, ease: "easeOut" }}
        />
      </div>
    </div>
  );
}

function armValue(stats: ArmStats, pick: (stats: ArmStats) => string): string {
  return stats.runs === 0 ? "—" : pick(stats);
}

function ExperimentCard({ experiment }: { experiment: ExperimentResult }) {
  const t = useT();
  const { pack, control, variant } = experiment;
  const variantOf = (pick: (stats: ArmStats) => string) => (variant ? armValue(variant, pick) : "");
  const rows: {
    label: string;
    pack: string;
    control: string;
    variant?: string;
    change?: string;
  }[] = [
    {
      label: t("Finished runs"),
      pack: String(pack.runs),
      control: String(control.runs),
      variant: variant ? String(variant.runs) : "",
    },
    {
      label: t("Succeeded"),
      pack: armValue(pack, (stats) => formatPercent(stats.successRate ?? 0)),
      variant: variantOf((stats) => formatPercent(stats.successRate ?? 0)),
      control: armValue(control, (stats) => formatPercent(stats.successRate ?? 0)),
    },
    {
      label: t("Input tokens per run"),
      pack: armValue(pack, (stats) => formatTokens(stats.medianContextTokens ?? 0)),
      variant: variantOf((stats) => formatTokens(stats.medianContextTokens ?? 0)),
      control: armValue(control, (stats) => formatTokens(stats.medianContextTokens ?? 0)),
      change: formatChange(experiment.tokenChange),
    },
    {
      label: t("Output tokens per run"),
      pack: armValue(pack, (stats) => formatTokens(stats.medianOutputTokens ?? 0)),
      variant: variantOf((stats) => formatTokens(stats.medianOutputTokens ?? 0)),
      control: armValue(control, (stats) => formatTokens(stats.medianOutputTokens ?? 0)),
    },
    {
      label: t("Cost per run"),
      pack: armValue(pack, (stats) => formatUsd(stats.medianCostUsd)),
      variant: variantOf((stats) => formatUsd(stats.medianCostUsd)),
      control: armValue(control, (stats) => formatUsd(stats.medianCostUsd)),
      change: formatChange(experiment.costChange),
    },
    {
      label: t("Turns per run"),
      pack: armValue(pack, (stats) => String(stats.medianTurns ?? "—")),
      variant: variantOf((stats) => String(stats.medianTurns ?? "—")),
      control: armValue(control, (stats) => String(stats.medianTurns ?? "—")),
    },
    {
      label: t("Files read per run"),
      pack: armValue(pack, (stats) => String(stats.medianReadFiles ?? "—")),
      variant: variantOf((stats) => String(stats.medianReadFiles ?? "—")),
      control: armValue(control, (stats) => String(stats.medianReadFiles ?? "—")),
    },
  ];
  return (
    <Card data-testid="savings-experiment" data-state={experiment.state}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FlaskConical className="size-4 text-primary" />
          {t("A/B experiment")}
          <EvidenceBadge evidence="measured" />
        </CardTitle>
        <CardDescription>
          {t(
            "A share of the runs that start a new Claude session runs without the Onyx context: no pack, no project map, no MCP tools. Comparing the two groups measures the saving on the token counts Claude reports. Resumed sessions are left out.",
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ExperimentForm
          key={`${experiment.settings.enabled}:${experiment.settings.controlShare}`}
          settings={experiment.settings}
        />
        {experiment.state === "OFF" && pack.runs + control.runs === 0 ? (
          <p className="text-xs text-muted-foreground">
            {t(
              "Runs without the context cost what they would cost without Onyx. With a {share} share, about one new session in {count} gets no context while the experiment runs.",
              {
                share: formatPercent(experiment.settings.controlShare),
                count: Math.round(1 / experiment.settings.controlShare),
              },
            )}
          </p>
        ) : null}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <ArmProgress
            label={t("With the context")}
            runs={pack.runs}
            min={experiment.minRunsPerArm}
          />
          <ArmProgress
            label={t("Without (control)")}
            runs={control.runs}
            min={experiment.minRunsPerArm}
          />
          {variant ? (
            <ArmProgress
              label={t("Files to edit as signatures")}
              runs={variant.runs}
              min={experiment.minRunsPerArm}
            />
          ) : null}
        </div>
        <div
          className="overflow-x-auto"
          tabIndex={0}
          role="region"
          aria-label={t("Context experiment results")}
        >
          <table className="w-full text-sm">
            <caption className="sr-only">
              {t("Median per run, with and without the Onyx context")}
            </caption>
            <thead className="text-left text-[10px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th scope="col" className="pb-2 font-medium">
                  {t("Median")}
                </th>
                <th scope="col" className="pb-2 pl-3 text-right font-medium">
                  {t("With")}
                </th>
                <th scope="col" className="pb-2 pl-3 text-right font-medium">
                  {t("Without")}
                </th>
                {variant ? (
                  <th scope="col" className="pb-2 pl-3 text-right font-medium">
                    {t("Signatures")}
                  </th>
                ) : null}
                <th scope="col" className="pb-2 pl-3 text-right font-medium">
                  {t("Change")}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((row) => (
                <tr key={row.label} className="tabular">
                  <th
                    scope="row"
                    className="py-1.5 pr-2 text-left font-normal text-muted-foreground"
                  >
                    {row.label}
                  </th>
                  <td className="py-1.5 pl-3 text-right">{row.pack}</td>
                  <td className="py-1.5 pl-3 text-right">{row.control}</td>
                  {variant ? <td className="py-1.5 pl-3 text-right">{row.variant}</td> : null}
                  <td className="py-1.5 pl-3 text-right font-medium">{row.change ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-muted-foreground">
          {t(
            "Mann–Whitney test on input tokens per run: {pValue} (a difference counts below 0.05)",
            {
              pValue: formatPValue(experiment.pValue, t),
            },
          )}
          {variant
            ? ` · ${t("signatures against the current context: {change}, {pValue}", {
                change: formatChange(experiment.variantTokenChange) || t("n/a"),
                pValue: formatPValue(experiment.variantPValue, t),
              })}`
            : ""}
          {` · ${t("{count} runs per arm needed", { count: experiment.minRunsPerArm })} · ${t(
            "last {days} days",
            { days: experiment.windowDays },
          )}`}
          {experiment.since ? (
            <>
              {` · ${t("first run")} `}
              <RelativeTime iso={experiment.since} />
            </>
          ) : null}
          {armProgress(experiment) < 1 && experiment.settings.enabled
            ? ` · ${t("collecting")}`
            : ""}
        </p>
      </CardContent>
    </Card>
  );
}

const MEMORY_STATE_TEXT: Record<MemoryExperiment["state"], string> = {
  OFF: msg("Off: turn it on in Settings → Project memory."),
  COLLECTING: msg("Collecting runs."),
  SAVING: msg("New sessions with the memory use fewer input tokens."),
  NO_DIFFERENCE: msg(
    "No measurable difference yet: the memory costs its tokens without a clear gain.",
  ),
  COSTS_MORE: msg("New sessions with the memory use more input tokens: consider turning it off."),
};

function memoryValue(stats: MemoryArmStats, pick: (stats: MemoryArmStats) => string): string {
  return stats.runs === 0 ? "—" : pick(stats);
}

function MemoryExperimentCard({ experiment }: { experiment: MemoryExperiment }) {
  const t = useT();
  const { withMemory, without } = experiment;
  const rows = [
    {
      label: t("Finished runs"),
      with: String(withMemory.runs),
      without: String(without.runs),
      change: "",
    },
    {
      label: t("Succeeded"),
      with: memoryValue(withMemory, (stats) => formatPercent(stats.successRate ?? 0)),
      without: memoryValue(without, (stats) => formatPercent(stats.successRate ?? 0)),
      change: "",
    },
    {
      label: t("Input tokens per run"),
      with: memoryValue(withMemory, (stats) => formatTokens(stats.medianContextTokens ?? 0)),
      without: memoryValue(without, (stats) => formatTokens(stats.medianContextTokens ?? 0)),
      change: formatChange(experiment.tokenChange),
    },
    {
      label: t("Files read per run"),
      with: memoryValue(withMemory, (stats) => String(stats.medianReadFiles ?? "—")),
      without: memoryValue(without, (stats) => String(stats.medianReadFiles ?? "—")),
      change: formatChange(experiment.readFilesChange),
    },
    {
      label: t("Turns per run"),
      with: memoryValue(withMemory, (stats) => String(stats.medianTurns ?? "—")),
      without: memoryValue(without, (stats) => String(stats.medianTurns ?? "—")),
      change: formatChange(experiment.turnsChange),
    },
  ];
  return (
    <Card id="memory-experiment" data-testid="memory-experiment" data-state={experiment.state}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FlaskConical className="size-4 text-primary" />
          {t("Project memory experiment")}
          <EvidenceBadge evidence="measured" />
        </CardTitle>
        <CardDescription>
          {t(MEMORY_STATE_TEXT[experiment.state])}{" "}
          {t(
            "Half of the new sessions start without the project memory; resumed sessions are left out.",
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <ArmProgress
            label={t("With memory")}
            runs={withMemory.runs}
            min={experiment.minRunsPerArm}
          />
          <ArmProgress label={t("Without")} runs={without.runs} min={experiment.minRunsPerArm} />
        </div>
        <div
          className="overflow-x-auto"
          tabIndex={0}
          role="region"
          aria-label={t("Memory experiment results")}
        >
          <table className="w-full text-sm">
            <caption className="sr-only">
              {t("Median per run, with and without the project memory")}
            </caption>
            <thead className="text-left text-[10px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th scope="col" className="pb-2 font-medium">
                  {t("Median")}
                </th>
                <th scope="col" className="pb-2 pl-3 text-right font-medium">
                  {t("With")}
                </th>
                <th scope="col" className="pb-2 pl-3 text-right font-medium">
                  {t("Without")}
                </th>
                <th scope="col" className="pb-2 pl-3 text-right font-medium">
                  {t("Change")}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((row) => (
                <tr key={row.label} className="tabular">
                  <th
                    scope="row"
                    className="py-1.5 pr-2 text-left font-normal text-muted-foreground"
                  >
                    {row.label}
                  </th>
                  <td className="py-1.5 pl-3 text-right">{row.with}</td>
                  <td className="py-1.5 pl-3 text-right">{row.without}</td>
                  <td className="py-1.5 pl-3 text-right font-medium">{row.change}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-muted-foreground">
          {t("Mann–Whitney test on input tokens per run: {pValue}", {
            pValue: formatPValue(experiment.pValue, t),
          })}
          {` · ${t("{count} runs per group needed", { count: experiment.minRunsPerArm })} · ${t(
            "last {days} days",
            { days: experiment.windowDays },
          )}`}
        </p>
      </CardContent>
    </Card>
  );
}

function ChecksCard({ checks }: { checks: SavingsCheck[] }) {
  const t = useT();
  return (
    <Card data-testid="savings-checks">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Gauge className="size-4 text-primary" />
          {t("Is it working?")}
        </CardTitle>
        <CardDescription>
          {t("What the recent runs say about the token reduction.")}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="space-y-3">
          {checks.map((check) => {
            const Icon = CHECK_ICONS[check.state];
            const tone = CHECK_TONES[check.state];
            return (
              <li
                key={check.id}
                className="flex gap-3"
                data-testid={`savings-check-${check.id}`}
                data-state={check.state}
              >
                <Icon className={cn("mt-0.5 size-4 shrink-0", TONE_TEXT[tone])} />
                <div className="min-w-0 space-y-0.5">
                  <p className="text-sm font-medium">{check.title}</p>
                  <p className="text-xs leading-relaxed text-muted-foreground">{check.detail}</p>
                </div>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

function Bar({
  label,
  value,
  segments,
}: {
  label: string;
  value: string;
  segments: { ratio: number; className: string }[];
}) {
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="tabular font-medium">{value}</span>
      </div>
      <div className="flex h-2.5 overflow-hidden rounded-full bg-surface-2">
        {segments.map((segment, index) => (
          <motion.div
            key={index}
            className={cn("h-full", segment.className)}
            initial={{ width: 0 }}
            animate={{ width: `${segment.ratio * 100}%` }}
            transition={{ duration: 0.7, ease: "easeOut", delay: index * 0.15 }}
          />
        ))}
      </div>
    </div>
  );
}

function PackCard({ pack }: { pack: PackAccounting }) {
  const t = useT();
  const bars = accountingBars(pack);
  const eligible = pack.runs - pack.controlRuns;
  return (
    <Card data-testid="savings-pack">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <Calculator className="size-4 text-primary" />
          {t("Context pack accounting · last {days} days", { days: pack.windowDays })}
          <EvidenceBadge evidence="estimate" />
        </CardTitle>
        <CardDescription>
          {t(
            "What the pack replaced, what it cost and what the agent read again anyway. The full-read figure assumes that without Onyx the agent reads every target and direct dependency once, in full.",
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat
            label={t("Runs with a pack")}
            value={`${pack.runsWithPack} / ${eligible}`}
            hint={
              pack.controlRuns > 0
                ? t("{count} control runs left out", { count: pack.controlRuns })
                : undefined
            }
          />
          <Stat
            label={t("Before re-reads")}
            value={savingText(pack.grossSaving, t)}
            hint={t("tokens: pack + map + MCP vs full reads")}
          />
          <Stat
            label={t("Net estimate")}
            value={savingText(pack.netSaving, t)}
            hint={t("tokens, after files read again")}
            {...(pack.netSaving === null
              ? {}
              : { tone: pack.netSaving > 0 ? ("success" as const) : ("danger" as const) })}
          />
          <Stat
            label={t("Re-reads")}
            value={
              pack.rereadFiles === 1 ? t("1 file") : t("{count} files", { count: pack.rereadFiles })
            }
            hint={`${t("{tokens} tokens", { tokens: formatTokens(pack.rereadTokens) })} · ${runCount(pack.runsWithRereads, t)}`}
          />
        </div>
        <div className="space-y-3">
          <Bar
            label={t("Reading the same files in full")}
            value={formatTokens(pack.baselineTokens)}
            segments={[{ ratio: bars.baseline, className: "bg-muted-foreground/45" }]}
          />
          <Bar
            label={t("With Onyx: delivered + read again")}
            value={formatTokens(pack.deliveredTokens + pack.rereadTokens)}
            segments={[
              { ratio: bars.delivered, className: "bg-primary" },
              { ratio: bars.reread, className: "bg-warning" },
            ]}
          />
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-primary" />
              {t("Delivered: pack, project map, MCP expansions ({tokens})", {
                tokens: formatTokens(pack.deliveredTokens),
              })}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-warning" />
              {t("Read again with Read ({tokens})", { tokens: formatTokens(pack.rereadTokens) })}
            </span>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <dl className="grid grid-cols-2 gap-y-1.5 text-sm">
            <dt className="text-muted-foreground">{t("Files read")}</dt>
            <dd className="tabular text-right">{pack.readFiles}</dd>
            <dt className="text-muted-foreground">{t("Read outside the pack")}</dt>
            <dd className="tabular text-right">{pack.missedFiles}</dd>
            <dt className="text-muted-foreground">{t("MCP expansions")}</dt>
            <dd className="tabular text-right">{pack.expansions}</dd>
          </dl>
          <div className="space-y-1.5">
            <p className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              <Repeat2 className="size-3" />
              {t("Most read again")}
            </p>
            {pack.topRereads.length === 0 ? (
              <p className="text-xs text-muted-foreground">{t("No re-reads recorded.")}</p>
            ) : (
              <ul className="space-y-1">
                {pack.topRereads.map((file) => (
                  <li key={file.relPath} className="flex items-center gap-2 text-xs">
                    <span className="min-w-0 flex-1 truncate font-mono">{file.relPath}</span>
                    <span className="tabular shrink-0 text-muted-foreground">
                      {runCount(file.runs, t)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function OtherCard({ other }: { other: OtherSavings }) {
  const t = useT();
  const reference = other.routingReferenceModelId
    ? modelLabel(other.routingReferenceModelId)
    : t("the reference model");
  return (
    <Card data-testid="savings-other">
      <CardHeader>
        <CardTitle>{t("Other savings")}</CardTitle>
        <CardDescription>
          {t("Not part of the context pack: shown so the totals are not mixed up.")}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="space-y-2 rounded-lg border border-border bg-surface-0/60 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium">{t("Prompt cache")}</p>
            <EvidenceBadge evidence="measured" />
          </div>
          <p className="tabular text-2xl font-semibold">{formatUsd(other.cacheSavedUsd)}</p>
          <p className="text-xs text-muted-foreground">
            {t(
              "{tokens} tokens served from Claude's cache in the last {days} days, priced at the input rate minus the cache-read rate.",
              { tokens: formatTokens(other.cacheReadTokens), days: other.windowDays },
            )}
          </p>
        </div>
        <div className="space-y-2 rounded-lg border border-border bg-surface-0/60 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium">{t("Model routing")}</p>
            <EvidenceBadge evidence="estimate" />
          </div>
          <p className="tabular text-2xl font-semibold">
            {other.routingSavedUsd === null ? "—" : formatUsd(other.routingSavedUsd)}
          </p>
          <p className="text-xs text-muted-foreground">
            {other.routingSavingRatio === null
              ? t("Appears after the first completed task.")
              : t(
                  "{percent} less than running every completed task on {model} with the same tokens.",
                  { percent: formatPercent(other.routingSavingRatio), model: reference },
                )}{" "}
            <Link
              href="/router"
              className="inline-flex items-center gap-1 text-primary hover:underline"
            >
              <Route className="size-3" />
              {t("Router")}
            </Link>
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function ledgerValue(row: SavingsLedgerRow, t: Translate): string {
  if (row.tokens !== null) {
    const tokens = t("{tokens} tokens", {
      tokens: `${row.tokens < 0 ? "−" : ""}${formatTokens(Math.abs(row.tokens))}`,
    });
    return row.usd !== null ? `${tokens} · ${formatUsd(row.usd)}` : tokens;
  }
  if (row.usd !== null) return formatUsd(row.usd);
  return "—";
}

function LedgerCard({ ledger }: { ledger: SavingsLedgerRow[] }) {
  const t = useT();
  return (
    <Card data-testid="savings-ledger">
      <CardHeader>
        <CardTitle>{t("Savings ledger")}</CardTitle>
        <CardDescription>
          {t(
            "Every way Onyx saves tokens, with how it is known: measured from Claude's own token counts, or estimated. Tokens are input-equivalent over the last 30 days; they are not added up because the methods differ.",
          )}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-border">
          {ledger.map((row) => (
            <li
              key={row.source}
              data-testid={`ledger-${row.source}`}
              className="grid grid-cols-1 gap-1 py-3 first:pt-0 last:pb-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-x-4"
            >
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <p className="text-sm font-medium">{t(SOURCE_LABELS[row.source])}</p>
                <EvidenceBadge evidence={row.evidence === "MEASURED" ? "measured" : "estimate"} />
                {row.runs > 0 ? (
                  <span className="text-[11px] text-muted-foreground">{runCount(row.runs, t)}</span>
                ) : null}
              </div>
              <p
                className={cn(
                  "tabular text-sm font-semibold sm:text-right",
                  row.tokens !== null && row.tokens < 0 ? "text-warning" : undefined,
                )}
              >
                {ledgerValue(row, t)}
              </p>
              <p className="text-xs text-muted-foreground sm:col-span-2">{row.detail}</p>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function CacheCard({ cache }: { cache: CacheReport }) {
  const t = useT();
  const lossShare = cache.resumedRuns > 0 ? cache.runsWithLoss / cache.resumedRuns : null;
  return (
    <Card data-testid="savings-cache">
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle>{t("Prompt cache on resumed runs")}</CardTitle>
          <EvidenceBadge evidence="measured" />
        </div>
        <CardDescription>
          {t(
            "A run that resumes a session should read the conversation back from Claude's cache. When it has to write it again, Onyx says why. Last {days} days.",
            { days: cache.windowDays },
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label={t("Resumed runs")} value={String(cache.resumedRuns)} />
          <Stat
            label={t("Cache lost")}
            value={lossShare === null ? "—" : formatPercent(lossShare)}
            hint={t("{lost} of {total} runs", {
              lost: cache.runsWithLoss,
              total: cache.resumedRuns,
            })}
            tone={lossShare !== null && lossShare > 0.25 ? "warning" : "neutral"}
          />
          <Stat label={t("Written again")} value={formatTokens(cache.lostTokens)} />
          <Stat label={t("Read back")} value={formatTokens(cache.readTokens)} tone="success" />
        </div>
        {cache.byReason.length === 0 ? (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <DatabaseZap className="size-3.5 text-success" />
            {cache.resumedRuns === 0
              ? t("No resumed runs yet.")
              : t("Every resumed run read its conversation back from the cache.")}
          </p>
        ) : (
          <ul className="space-y-2">
            {cache.byReason.map((row) => (
              <li
                key={row.reason}
                className="rounded-lg border border-border bg-surface-0/60 px-3 py-2 text-xs"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{t(CACHE_LOSS_LABELS[row.reason])}</span>
                  <span className="tabular text-muted-foreground">
                    {`${runCount(row.runs, t)} · ${t("{tokens} tokens", { tokens: formatTokens(row.lostTokens) })}`}
                  </span>
                </div>
                <p className="mt-1 text-muted-foreground">{t(CACHE_LOSS_HINTS[row.reason])}</p>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export function SavingsDashboard({ initial }: { initial: SavingsReport }) {
  useLiveSystem();
  const { data } = useQuery({
    queryKey: queryKeys.savings,
    queryFn: () => api.get<SavingsReport>("/api/telemetry/savings"),
    initialData: initial,
    refetchInterval: 60_000,
  });
  return (
    <div className="space-y-6">
      <VerdictCard verdict={data.verdict} />
      <LedgerCard ledger={data.ledger} />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <ExperimentCard experiment={data.experiment} />
        <ChecksCard checks={data.checks} />
      </div>
      <MemoryExperimentCard experiment={data.memory} />
      <PackCard pack={data.pack} />
      <CacheCard cache={data.cache} />
      <OtherCard other={data.other} />
    </div>
  );
}
