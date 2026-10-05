import type { SavingsLedgerRow } from "@onyx/contracts";
import { describe, expect, it } from "vitest";
import { translator } from "@/lib/i18n/core";
import { savingsSummary, SOURCE_TERMS, summarySentence } from "@/lib/savings-summary";
import { GLOSSARY } from "@/lib/glossary";

function row(
  source: SavingsLedgerRow["source"],
  evidence: SavingsLedgerRow["evidence"],
  tokens: number | null,
  runs = 0,
): SavingsLedgerRow {
  return { source, evidence, tokens, usd: null, runs, detail: "" };
}

describe("savings summary", () => {
  it("says there is nothing yet without positive savings", () => {
    const summary = savingsSummary([
      row("qa-review", "MEASURED", -4_000, 3),
      row("routing", "ESTIMATED", null),
    ]);
    expect(summary.evidence).toBe("none");
    expect(summarySentence(summary)).toBe(
      "There are not enough runs yet to say how many tokens Onyx saves you.",
    );
  });

  it("adds up estimated lines", () => {
    const summary = savingsSummary([
      row("context-pack", "ESTIMATED", 120_000, 40),
      row("insights", "ESTIMATED", 30_000, 5),
    ]);
    expect(summary).toMatchObject({ evidence: "estimated", tokens: 150_000, sources: 2 });
    expect(summarySentence(summary)).toBe(
      "In the last 30 days Onyx saved you about 150K tokens (estimate).",
    );
  });

  it("counts the runs of the largest measured line", () => {
    const summary = savingsSummary([
      row("prompt-cache", "MEASURED", 2_000_000, 80),
      row("small-task-batching", "MEASURED", 5_000, 6),
    ]);
    expect(summary).toMatchObject({ evidence: "measured", measuredRuns: 80 });
    expect(summarySentence(summary)).toBe(
      "In the last 30 days Onyx saved you about 2M tokens, measured on at least 80 runs.",
    );
    expect(summarySentence(savingsSummary([row("prompt-cache", "MEASURED", 900, 1)]))).toBe(
      "In the last 30 days Onyx saved you about 900 tokens, measured on 1 run.",
    );
    expect(summarySentence(savingsSummary([row("prompt-cache", "MEASURED", 900, 0)]))).toBe(
      "In the last 30 days Onyx saved you about 900 tokens, measured.",
    );
  });

  it("tells measured and estimated apart when both are there", () => {
    const summary = savingsSummary([
      row("prompt-cache", "MEASURED", 50_000, 12),
      row("context-pack", "ESTIMATED", 25_000, 12),
      row("conflict-resolution", "MEASURED", -1_000, 1),
    ]);
    expect(summary).toMatchObject({
      evidence: "mixed",
      tokens: 75_000,
      measuredTokens: 50_000,
      estimatedTokens: 25_000,
    });
    expect(summarySentence(summary, translator("it"))).toBe(
      "Negli ultimi 30 giorni Onyx ti ha fatto risparmiare circa 75K token: 50K misurati su run reali, il resto stimato.",
    );
  });

  it("points every ledger line with a term to an existing glossary entry", () => {
    const ids = new Set(GLOSSARY.map((entry) => entry.id));
    for (const term of Object.values(SOURCE_TERMS)) expect(ids.has(term)).toBe(true);
  });
});
