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

function EvidenceBadge({ evidence }: { evidence: Evidence }) {
  if (evidence === "none") return null;
  return evidence === "measured" ? (
    <Badge
      tone="success"
      title="Computed from the token counts Claude reports for runs with and without the Onyx context"
    >
      <FlaskConical className="size-3" />
      Measured
    </Badge>
  ) : (
    <Badge title="Computed from assumptions about what the agent would read without Onyx">
      <Calculator className="size-3" />
      Estimate
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
            <Badge tone={style.tone}>{style.label}</Badge>
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
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(settings);
  const dirty = draft.enabled !== settings.enabled || draft.controlShare !== settings.controlShare;
  const save = useMutation({
    mutationFn: () =>
      api.put<ContextExperimentSettings>("/api/telemetry/savings/experiment", draft),
    onSuccess: (saved) => {
      setDraft(saved);
      void queryClient.invalidateQueries({ queryKey: queryKeys.savings });
      toast.success(saved.enabled ? "Experiment running" : "Experiment stopped");
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface-0/50 p-3 sm:flex-row sm:items-center">
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
        Run the experiment
      </label>
      <label className="flex items-center gap-2 text-sm text-muted-foreground sm:ml-4">
        Without the context
        <Select
          aria-label="Share of runs without the context"
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
      <Button
        size="sm"
        className="sm:ml-auto"
        disabled={!dirty || save.isPending}
        onClick={() => save.mutate()}
        data-testid="experiment-save"
      >
        {save.isPending ? <Loader2 className="animate-spin" /> : null}
        Save
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
  const { pack, control } = experiment;
  const rows: { label: string; pack: string; control: string; change?: string }[] = [
    { label: "Finished runs", pack: String(pack.runs), control: String(control.runs) },
    {
      label: "Succeeded",
      pack: armValue(pack, (stats) => formatPercent(stats.successRate ?? 0)),
      control: armValue(control, (stats) => formatPercent(stats.successRate ?? 0)),
    },
    {
      label: "Input tokens per run",
      pack: armValue(pack, (stats) => formatTokens(stats.medianContextTokens ?? 0)),
      control: armValue(control, (stats) => formatTokens(stats.medianContextTokens ?? 0)),
      change: formatChange(experiment.tokenChange),
    },
    {
      label: "Output tokens per run",
      pack: armValue(pack, (stats) => formatTokens(stats.medianOutputTokens ?? 0)),
      control: armValue(control, (stats) => formatTokens(stats.medianOutputTokens ?? 0)),
    },
    {
      label: "Cost per run",
      pack: armValue(pack, (stats) => formatUsd(stats.medianCostUsd)),
      control: armValue(control, (stats) => formatUsd(stats.medianCostUsd)),
      change: formatChange(experiment.costChange),
    },
    {
      label: "Turns per run",
      pack: armValue(pack, (stats) => String(stats.medianTurns ?? "—")),
      control: armValue(control, (stats) => String(stats.medianTurns ?? "—")),
    },
    {
      label: "Files read per run",
      pack: armValue(pack, (stats) => String(stats.medianReadFiles ?? "—")),
      control: armValue(control, (stats) => String(stats.medianReadFiles ?? "—")),
    },
  ];
  return (
    <Card data-testid="savings-experiment" data-state={experiment.state}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FlaskConical className="size-4 text-primary" />
          A/B experiment
          <EvidenceBadge evidence="measured" />
        </CardTitle>
        <CardDescription>
          A share of the runs that start a new Claude session runs without the Onyx context: no
          pack, no project map, no MCP tools. Comparing the two groups measures the saving on the
          token counts Claude reports. Resumed sessions are left out.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ExperimentForm
          key={`${experiment.settings.enabled}:${experiment.settings.controlShare}`}
          settings={experiment.settings}
        />
        {experiment.state === "OFF" && pack.runs + control.runs === 0 ? (
          <p className="text-xs text-muted-foreground">
            Runs without the context cost what they would cost without Onyx. With a{" "}
            {formatPercent(experiment.settings.controlShare)} share, about one new session in{" "}
            {Math.round(1 / experiment.settings.controlShare)} gets no context while the experiment
            runs.
          </p>
        ) : null}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <ArmProgress label="With the context" runs={pack.runs} min={experiment.minRunsPerArm} />
          <ArmProgress
            label="Without (control)"
            runs={control.runs}
            min={experiment.minRunsPerArm}
          />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">Median per run, with and without the Onyx context</caption>
            <thead className="text-left text-[10px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th scope="col" className="pb-2 font-medium">
                  Median
                </th>
                <th scope="col" className="pb-2 pl-3 text-right font-medium">
                  With
                </th>
                <th scope="col" className="pb-2 pl-3 text-right font-medium">
                  Without
                </th>
                <th scope="col" className="pb-2 pl-3 text-right font-medium">
                  Change
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
                  <td className="py-1.5 pl-3 text-right font-medium">{row.change ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Mann–Whitney test on input tokens per run: {formatPValue(experiment.pValue)} (a difference
          counts below 0.05) · {experiment.minRunsPerArm} runs per arm needed · last{" "}
          {experiment.windowDays} days
          {experiment.since ? (
            <>
              {" "}
              · first run <RelativeTime iso={experiment.since} />
            </>
          ) : null}
          {armProgress(experiment) < 1 && experiment.settings.enabled ? " · collecting" : ""}
        </p>
      </CardContent>
    </Card>
  );
}

const MEMORY_STATE_TEXT: Record<MemoryExperiment["state"], string> = {
  OFF: "Off: turn it on in Settings → Project memory.",
  COLLECTING: "Collecting runs.",
  SAVING: "New sessions with the memory use fewer input tokens.",
  NO_DIFFERENCE: "No measurable difference yet: the memory costs its tokens without a clear gain.",
  COSTS_MORE: "New sessions with the memory use more input tokens: consider turning it off.",
};

function memoryValue(stats: MemoryArmStats, pick: (stats: MemoryArmStats) => string): string {
  return stats.runs === 0 ? "—" : pick(stats);
}

function MemoryExperimentCard({ experiment }: { experiment: MemoryExperiment }) {
  const { withMemory, without } = experiment;
  const rows = [
    {
      label: "Finished runs",
      with: String(withMemory.runs),
      without: String(without.runs),
      change: "",
    },
    {
      label: "Succeeded",
      with: memoryValue(withMemory, (stats) => formatPercent(stats.successRate ?? 0)),
      without: memoryValue(without, (stats) => formatPercent(stats.successRate ?? 0)),
      change: "",
    },
    {
      label: "Input tokens per run",
      with: memoryValue(withMemory, (stats) => formatTokens(stats.medianContextTokens ?? 0)),
      without: memoryValue(without, (stats) => formatTokens(stats.medianContextTokens ?? 0)),
      change: formatChange(experiment.tokenChange),
    },
    {
      label: "Files read per run",
      with: memoryValue(withMemory, (stats) => String(stats.medianReadFiles ?? "—")),
      without: memoryValue(without, (stats) => String(stats.medianReadFiles ?? "—")),
      change: formatChange(experiment.readFilesChange),
    },
    {
      label: "Turns per run",
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
          Project memory experiment
          <EvidenceBadge evidence="measured" />
        </CardTitle>
        <CardDescription>
          {MEMORY_STATE_TEXT[experiment.state]} Half of the new sessions start without the project
          memory; resumed sessions are left out.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <ArmProgress label="With memory" runs={withMemory.runs} min={experiment.minRunsPerArm} />
          <ArmProgress label="Without" runs={without.runs} min={experiment.minRunsPerArm} />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">
              Median per run, with and without the project memory
            </caption>
            <thead className="text-left text-[10px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th scope="col" className="pb-2 font-medium">
                  Median
                </th>
                <th scope="col" className="pb-2 pl-3 text-right font-medium">
                  With
                </th>
                <th scope="col" className="pb-2 pl-3 text-right font-medium">
                  Without
                </th>
                <th scope="col" className="pb-2 pl-3 text-right font-medium">
                  Change
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
          Mann–Whitney test on input tokens per run: {formatPValue(experiment.pValue)} ·{" "}
          {experiment.minRunsPerArm} runs per group needed · last {experiment.windowDays} days
        </p>
      </CardContent>
    </Card>
  );
}

function ChecksCard({ checks }: { checks: SavingsCheck[] }) {
  return (
    <Card data-testid="savings-checks">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Gauge className="size-4 text-primary" />
          Is it working?
        </CardTitle>
        <CardDescription>What the recent runs say about the token reduction.</CardDescription>
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
  const bars = accountingBars(pack);
  const eligible = pack.runs - pack.controlRuns;
  return (
    <Card data-testid="savings-pack">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <Calculator className="size-4 text-primary" />
          Context pack accounting · last {pack.windowDays} days
          <EvidenceBadge evidence="estimate" />
        </CardTitle>
        <CardDescription>
          What the pack replaced, what it cost and what the agent read again anyway. The full-read
          figure assumes that without Onyx the agent reads every target and direct dependency once,
          in full.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat
            label="Runs with a pack"
            value={`${pack.runsWithPack} / ${eligible}`}
            hint={pack.controlRuns > 0 ? `${pack.controlRuns} control runs left out` : undefined}
          />
          <Stat
            label="Before re-reads"
            value={savingText(pack.grossSaving)}
            hint="tokens: pack + map + MCP vs full reads"
          />
          <Stat
            label="Net estimate"
            value={savingText(pack.netSaving)}
            hint="tokens, after files read again"
            {...(pack.netSaving === null
              ? {}
              : { tone: pack.netSaving > 0 ? ("success" as const) : ("danger" as const) })}
          />
          <Stat
            label="Read again"
            value={`${pack.rereadFiles} files`}
            hint={`${formatTokens(pack.rereadTokens)} tokens · ${pack.runsWithRereads} runs`}
          />
        </div>
        <div className="space-y-3">
          <Bar
            label="Reading the same files in full"
            value={formatTokens(pack.baselineTokens)}
            segments={[{ ratio: bars.baseline, className: "bg-muted-foreground/45" }]}
          />
          <Bar
            label="With Onyx: delivered + read again"
            value={formatTokens(pack.deliveredTokens + pack.rereadTokens)}
            segments={[
              { ratio: bars.delivered, className: "bg-primary" },
              { ratio: bars.reread, className: "bg-warning" },
            ]}
          />
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-primary" />
              Delivered: pack, project map, MCP expansions ({formatTokens(pack.deliveredTokens)})
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-warning" />
              Read again with Read ({formatTokens(pack.rereadTokens)})
            </span>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <dl className="grid grid-cols-2 gap-y-1.5 text-sm">
            <dt className="text-muted-foreground">Files read</dt>
            <dd className="tabular text-right">{pack.readFiles}</dd>
            <dt className="text-muted-foreground">Read outside the pack</dt>
            <dd className="tabular text-right">{pack.missedFiles}</dd>
            <dt className="text-muted-foreground">MCP expansions</dt>
            <dd className="tabular text-right">{pack.expansions}</dd>
          </dl>
          <div className="space-y-1.5">
            <p className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              <Repeat2 className="size-3" />
              Most read again
            </p>
            {pack.topRereads.length === 0 ? (
              <p className="text-xs text-muted-foreground">No re-reads recorded.</p>
            ) : (
              <ul className="space-y-1">
                {pack.topRereads.map((file) => (
                  <li key={file.relPath} className="flex items-center gap-2 text-xs">
                    <span className="min-w-0 flex-1 truncate font-mono">{file.relPath}</span>
                    <span className="tabular shrink-0 text-muted-foreground">
                      {file.runs} {file.runs === 1 ? "run" : "runs"}
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
  const reference = other.routingReferenceModelId
    ? modelLabel(other.routingReferenceModelId)
    : "the reference model";
  return (
    <Card data-testid="savings-other">
      <CardHeader>
        <CardTitle>Other savings</CardTitle>
        <CardDescription>
          Not part of the context pack: shown so the totals are not mixed up.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="space-y-2 rounded-lg border border-border bg-surface-0/60 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium">Prompt cache</p>
            <EvidenceBadge evidence="measured" />
          </div>
          <p className="tabular text-2xl font-semibold">{formatUsd(other.cacheSavedUsd)}</p>
          <p className="text-xs text-muted-foreground">
            {formatTokens(other.cacheReadTokens)} tokens served from Claude&apos;s cache in the last{" "}
            {other.windowDays} days, priced at the input rate minus the cache-read rate.
          </p>
        </div>
        <div className="space-y-2 rounded-lg border border-border bg-surface-0/60 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium">Model routing</p>
            <EvidenceBadge evidence="estimate" />
          </div>
          <p className="tabular text-2xl font-semibold">
            {other.routingSavedUsd === null ? "—" : formatUsd(other.routingSavedUsd)}
          </p>
          <p className="text-xs text-muted-foreground">
            {other.routingSavingRatio === null
              ? "Appears after the first completed task."
              : `${formatPercent(other.routingSavingRatio)} less than running every completed task on ${reference} with the same tokens.`}{" "}
            <Link
              href="/router"
              className="inline-flex items-center gap-1 text-primary hover:underline"
            >
              <Route className="size-3" />
              Router
            </Link>
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function ledgerValue(row: SavingsLedgerRow): string {
  if (row.tokens !== null) {
    const tokens = `${row.tokens < 0 ? "−" : ""}${formatTokens(Math.abs(row.tokens))} tokens`;
    return row.usd !== null ? `${tokens} · ${formatUsd(row.usd)}` : tokens;
  }
  if (row.usd !== null) return formatUsd(row.usd);
  return "—";
}

function LedgerCard({ ledger }: { ledger: SavingsLedgerRow[] }) {
  return (
    <Card data-testid="savings-ledger">
      <CardHeader>
        <CardTitle>Savings ledger</CardTitle>
        <CardDescription>
          Every way Onyx saves tokens, with how it is known: measured from Claude&apos;s own token
          counts, or estimated. Tokens are input-equivalent over the last 30 days; they are not
          added up because the methods differ.
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
                <p className="text-sm font-medium">{SOURCE_LABELS[row.source]}</p>
                <EvidenceBadge evidence={row.evidence === "MEASURED" ? "measured" : "estimate"} />
                {row.runs > 0 ? (
                  <span className="text-[11px] text-muted-foreground">
                    {row.runs} {row.runs === 1 ? "run" : "runs"}
                  </span>
                ) : null}
              </div>
              <p
                className={cn(
                  "tabular text-sm font-semibold sm:text-right",
                  row.tokens !== null && row.tokens < 0 ? "text-warning" : undefined,
                )}
              >
                {ledgerValue(row)}
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
  const lossShare = cache.resumedRuns > 0 ? cache.runsWithLoss / cache.resumedRuns : null;
  return (
    <Card data-testid="savings-cache">
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle>Prompt cache on resumed runs</CardTitle>
          <EvidenceBadge evidence="measured" />
        </div>
        <CardDescription>
          A run that resumes a session should read the conversation back from Claude&apos;s cache.
          When it has to write it again, Onyx says why. Last {cache.windowDays} days.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Resumed runs" value={String(cache.resumedRuns)} />
          <Stat
            label="Cache lost"
            value={lossShare === null ? "—" : formatPercent(lossShare)}
            hint={`${cache.runsWithLoss} of ${cache.resumedRuns} runs`}
            tone={lossShare !== null && lossShare > 0.25 ? "warning" : "neutral"}
          />
          <Stat label="Written again" value={formatTokens(cache.lostTokens)} />
          <Stat label="Read back" value={formatTokens(cache.readTokens)} tone="success" />
        </div>
        {cache.byReason.length === 0 ? (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <DatabaseZap className="size-3.5 text-success" />
            {cache.resumedRuns === 0
              ? "No resumed runs yet."
              : "Every resumed run read its conversation back from the cache."}
          </p>
        ) : (
          <ul className="space-y-2">
            {cache.byReason.map((row) => (
              <li
                key={row.reason}
                className="rounded-lg border border-border bg-surface-0/60 px-3 py-2 text-xs"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{CACHE_LOSS_LABELS[row.reason]}</span>
                  <span className="tabular text-muted-foreground">
                    {row.runs} {row.runs === 1 ? "run" : "runs"} · {formatTokens(row.lostTokens)}{" "}
                    tokens
                  </span>
                </div>
                <p className="mt-1 text-muted-foreground">{CACHE_LOSS_HINTS[row.reason]}</p>
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
