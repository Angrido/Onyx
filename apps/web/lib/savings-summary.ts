import type { SavingsLedgerRow, SavingsSource } from "@onyx/contracts";
import { formatTokens } from "@/lib/format";
import type { GlossaryId } from "@/lib/glossary";
import { english, type Translate } from "@/lib/i18n/core";

export type SummaryEvidence = "none" | "measured" | "estimated" | "mixed";

export interface SavingsSummary {
  evidence: SummaryEvidence;
  tokens: number;
  measuredTokens: number;
  estimatedTokens: number;
  measuredRuns: number;
  sources: number;
}

export function savingsSummary(ledger: readonly SavingsLedgerRow[]): SavingsSummary {
  let measuredTokens = 0;
  let estimatedTokens = 0;
  let measuredRuns = 0;
  let sources = 0;
  for (const row of ledger) {
    if (row.tokens === null || row.tokens <= 0) continue;
    sources += 1;
    if (row.evidence === "MEASURED") {
      measuredTokens += row.tokens;
      measuredRuns = Math.max(measuredRuns, row.runs);
    } else estimatedTokens += row.tokens;
  }
  const evidence: SummaryEvidence =
    sources === 0
      ? "none"
      : measuredTokens > 0 && estimatedTokens > 0
        ? "mixed"
        : measuredTokens > 0
          ? "measured"
          : "estimated";
  return {
    evidence,
    tokens: measuredTokens + estimatedTokens,
    measuredTokens,
    estimatedTokens,
    measuredRuns,
    sources,
  };
}

export function summarySentence(summary: SavingsSummary, t: Translate = english): string {
  const tokens = formatTokens(summary.tokens);
  const runs = summary.measuredRuns;
  switch (summary.evidence) {
    case "none":
      return t("There are not enough runs yet to say how many tokens Onyx saves you.");
    case "estimated":
      return t("In the last 30 days Onyx saved you about {tokens} tokens (estimate).", { tokens });
    case "measured":
      if (runs === 0)
        return t("In the last 30 days Onyx saved you about {tokens} tokens, measured.", {
          tokens,
        });
      return runs === 1
        ? t("In the last 30 days Onyx saved you about {tokens} tokens, measured on 1 run.", {
            tokens,
          })
        : t(
            "In the last 30 days Onyx saved you about {tokens} tokens, measured on at least {runs} runs.",
            { tokens, runs },
          );
    case "mixed":
      return t(
        "In the last 30 days Onyx saved you about {tokens} tokens: {measured} measured on real runs, the rest estimated.",
        { tokens, measured: formatTokens(summary.measuredTokens) },
      );
  }
}

export const SOURCE_TERMS: Partial<Record<SavingsSource, GlossaryId>> = {
  "context-pack": "context",
  "stable-prefix": "map",
  "pack-reuse": "session",
  "prompt-cache": "cache",
  routing: "tier",
  "stack-commands": "commands",
  quota: "canWait",
  "project-memory": "memory",
  "qa-review": "qa",
  insights: "insights",
  ideation: "ideation",
};
