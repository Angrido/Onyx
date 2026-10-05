import type {
  CacheLoss,
  ContextItem,
  ExperimentResult,
  PackAccounting,
  RunCacheDto,
  RunContextDto,
  SavingsCheckState,
  SavingsSource,
  SavingsVerdictState,
} from "@onyx/contracts";
import { english, msg, type Translate } from "@/lib/i18n/core";
import { formatPercent, formatTokens } from "./format";

export type Evidence = "measured" | "estimate" | "none";
export type SavingsTone = "success" | "warning" | "danger" | "primary" | "neutral";

export const VERDICT_STYLES: Record<
  SavingsVerdictState,
  { label: string; tone: SavingsTone; evidence: Evidence }
> = {
  CONFIRMED: { label: msg("Saving confirmed"), tone: "success", evidence: "measured" },
  NOT_PAYING: { label: msg("Not paying off"), tone: "danger", evidence: "measured" },
  NO_DIFFERENCE: { label: msg("No clear difference"), tone: "warning", evidence: "measured" },
  COLLECTING: { label: msg("Measuring"), tone: "primary", evidence: "estimate" },
  ESTIMATE_ONLY: { label: msg("Estimate only"), tone: "neutral", evidence: "estimate" },
  NO_DATA: { label: msg("No data yet"), tone: "neutral", evidence: "none" },
};

export const CHECK_TONES: Record<SavingsCheckState, SavingsTone> = {
  ok: "success",
  warn: "warning",
  fail: "danger",
  idle: "neutral",
};

export const CONTROL_SHARES = [0.1, 0.2, 0.25, 0.3, 0.4, 0.5] as const;

export function formatChange(change: number | null): string {
  if (change === null) return "—";
  if (Math.round(change * 100) === 0) return "±0%";
  return change < 0 ? `−${formatPercent(-change)}` : `+${formatPercent(change)}`;
}

export function savingText(ratio: number | null, t: Translate = english): string {
  if (ratio === null) return "—";
  return ratio >= 0
    ? t("{percent} fewer", { percent: formatPercent(ratio) })
    : t("{percent} more", { percent: formatPercent(-ratio) });
}

export function formatPValue(pValue: number | null, t: Translate = english): string {
  if (pValue === null) return t("p not available");
  return pValue < 0.001 ? "p < 0.001" : `p = ${pValue.toFixed(3)}`;
}

export function armProgress(experiment: ExperimentResult): number {
  if (experiment.minRunsPerArm <= 0) return 1;
  return Math.min(
    1,
    Math.min(experiment.pack.runs, experiment.control.runs) / experiment.minRunsPerArm,
  );
}

export interface AccountingBars {
  baseline: number;
  delivered: number;
  reread: number;
  scale: number;
}

export function accountingBars(pack: PackAccounting): AccountingBars {
  const scale = Math.max(1, pack.baselineTokens, pack.deliveredTokens + pack.rereadTokens);
  return {
    baseline: pack.baselineTokens / scale,
    delivered: pack.deliveredTokens / scale,
    reread: pack.rereadTokens / scale,
    scale,
  };
}

export type RunSaving =
  | { kind: "none" }
  | { kind: "control" }
  | {
      kind: "estimate";
      gross: number;
      net: number | null;
      rereadFiles: number;
      rereadTokens: number;
    };

export function runSaving(item: ContextItem | null, context: RunContextDto | null): RunSaving {
  if (item?.arm === "CONTROL" || context?.arm === "CONTROL") return { kind: "control" };
  const baseline = context?.baselineTokens ?? item?.baselineTokens ?? 0;
  if (baseline <= 0) return { kind: "none" };
  const delivered = context?.deliveredTokens ?? item?.deliveredTokens ?? 0;
  const gross = 1 - delivered / baseline;
  const rereadTokens = context?.rereadTokens ?? null;
  return {
    kind: "estimate",
    gross,
    net: rereadTokens === null ? null : 1 - (delivered + rereadTokens) / baseline,
    rereadFiles: context?.rereadFiles ?? 0,
    rereadTokens: rereadTokens ?? 0,
  };
}

export const SOURCE_LABELS: Record<SavingsSource, string> = {
  "context-pack": msg("Onyx context (pack, map, MCP)"),
  "stable-prefix": msg("Project map kept for the session"),
  "pack-reuse": msg("Pack not sent again on resume"),
  "prompt-cache": msg("Claude prompt cache"),
  routing: msg("Model routing"),
  "stack-commands": msg("Commands allowed for the stack"),
  quota: msg("Tasks held near the Claude limit"),
  "project-memory": msg("Project memory in new sessions"),
  "target-signatures": msg("Files to edit sent as signatures"),
  "concise-answers": msg("Short final summaries"),
  "exploration-models": msg("Plan exploration on a cheaper model"),
  "small-task-batching": msg("Small tasks grouped in one run"),
  "qa-review": msg("QA before merging (cost)"),
  "conflict-resolution": msg("Merge conflicts resolved by Claude (cost)"),
  insights: msg("Code questions answered from the index"),
  ideation: msg("Ideation: Claude reads only suspicious snippets"),
};

export const CACHE_LOSS_LABELS: Record<CacheLoss, string> = {
  NEW_SESSION: msg("New session"),
  NONE: msg("Read from the cache"),
  PREFIX_CHANGED: msg("System prompt changed"),
  MODEL_CHANGED: msg("Model changed"),
  EXPIRED: msg("Cache expired during the pause"),
  UNKNOWN: msg("Unexplained"),
};

export const CACHE_LOSS_HINTS: Record<CacheLoss, string> = {
  NEW_SESSION: msg("A new session always writes its prompt into the cache."),
  NONE: msg("The conversation was read back from the cache."),
  PREFIX_CHANGED: msg(
    "The workspace primer, the agent's instructions or its sub-agents changed between the runs of this session.",
  ),
  MODEL_CHANGED: msg(
    "The cache belongs to one model: switching model mid-session writes it again.",
  ),
  EXPIRED: msg(
    "The session was resumed after the cache lifetime: follow-ups sent sooner reuse it (ONYX_PROMPT_CACHE_TTL_MINUTES).",
  ),
  UNKNOWN: msg(
    "Claude Code wrote the conversation again for a reason Onyx cannot see, for example its own system prompt changed.",
  ),
};

export interface CacheNote {
  tone: SavingsTone;
  text: string;
}

export function cacheNote(cache: RunCacheDto, t: Translate = english): CacheNote | null {
  if (cache.loss === null || cache.loss === "NEW_SESSION") return null;
  if (cache.loss === "NONE")
    return {
      tone: "success",
      text: t(
        "Resumed from Claude's prompt cache: {tokens} tokens read back instead of written again.",
        { tokens: formatTokens(cache.readTokens ?? 0) },
      ),
    };
  return {
    tone: "warning",
    text: t("Prompt cache lost: {tokens} tokens written again ({reason}). {hint}", {
      tokens: formatTokens(cache.lostTokens ?? 0),
      reason: t(CACHE_LOSS_LABELS[cache.loss]).toLowerCase(),
      hint: t(CACHE_LOSS_HINTS[cache.loss]),
    }),
  };
}
