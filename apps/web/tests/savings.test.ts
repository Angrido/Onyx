import type { ContextItem, ExperimentResult, PackAccounting, RunContextDto } from "@onyx/contracts";
import { describe, expect, it } from "vitest";
import {
  accountingBars,
  armProgress,
  cacheNote,
  formatChange,
  formatPValue,
  runSaving,
  savingText,
  VERDICT_STYLES,
} from "@/lib/savings";

const item: ContextItem = {
  kind: "context",
  targets: ["src/a.ts"],
  inferredTargets: [],
  entries: [],
  mapTokens: 200,
  packTokens: 800,
  baselineTokens: 4_000,
  deliveredTokens: 1_000,
  reusedTokens: 0,
  mapFrozen: false,
  indexedAt: null,
  mcpEnabled: true,
  note: null,
  arm: null,
};

const finished: RunContextDto = {
  baselineTokens: 4_000,
  deliveredTokens: 1_200,
  expansions: 1,
  arm: "PACK",
  readFiles: 3,
  rereadFiles: 1,
  rereadTokens: 1_000,
  missedFiles: 1,
  rereadPaths: ["src/a.ts"],
  reusedTokens: null,
};

function arm(runs: number) {
  return {
    arm: "PACK" as const,
    runs,
    completed: runs,
    successRate: 1,
    medianContextTokens: 1,
    medianOutputTokens: 1,
    medianCostUsd: 1,
    medianTurns: 1,
    medianReadFiles: 1,
    totalCostUsd: 1,
  };
}

describe("run saving", () => {
  it("shows the gross estimate while the run is live", () => {
    expect(runSaving(item, null)).toEqual({
      kind: "estimate",
      gross: 0.75,
      net: null,
      rereadFiles: 0,
      rereadTokens: 0,
    });
  });

  it("subtracts re-reads once the run has finished", () => {
    const saving = runSaving(item, finished);
    expect(saving.kind).toBe("estimate");
    if (saving.kind !== "estimate") return;
    expect(saving.gross).toBeCloseTo(0.7);
    expect(saving.net).toBeCloseTo(0.45);
    expect(saving.rereadFiles).toBe(1);
  });

  it("recognizes control runs and runs without a pack", () => {
    expect(runSaving({ ...item, arm: "CONTROL" }, null)).toEqual({ kind: "control" });
    expect(runSaving(null, { ...finished, arm: "CONTROL" })).toEqual({ kind: "control" });
    expect(runSaving({ ...item, baselineTokens: 0 }, null)).toEqual({ kind: "none" });
  });
});

describe("savings formatting", () => {
  it("formats changes and p-values", () => {
    expect(formatChange(-0.34)).toBe("−34%");
    expect(formatChange(0.12)).toBe("+12%");
    expect(formatChange(0.001)).toBe("±0%");
    expect(formatChange(null)).toBe("—");
    expect(formatPValue(0.0004)).toBe("p < 0.001");
    expect(formatPValue(0.0213)).toBe("p = 0.021");
    expect(formatPValue(null)).toBe("p not available");
    expect(savingText(0.45)).toBe("45% fewer");
    expect(savingText(-7.41)).toBe("741% more");
    expect(savingText(null)).toBe("—");
  });

  it("labels each verdict as measured or estimated", () => {
    expect(VERDICT_STYLES.CONFIRMED.evidence).toBe("measured");
    expect(VERDICT_STYLES.NOT_PAYING.evidence).toBe("measured");
    expect(VERDICT_STYLES.ESTIMATE_ONLY.evidence).toBe("estimate");
    expect(VERDICT_STYLES.NO_DATA.evidence).toBe("none");
  });

  it("tracks experiment progress on the smaller arm", () => {
    const experiment = {
      minRunsPerArm: 10,
      pack: arm(12),
      control: { ...arm(4), arm: "CONTROL" as const },
    } as ExperimentResult;
    expect(armProgress(experiment)).toBeCloseTo(0.4);
  });

  it("scales the accounting bars to the larger side", () => {
    const pack = {
      baselineTokens: 10_000,
      deliveredTokens: 3_000,
      rereadTokens: 1_000,
    } as PackAccounting;
    expect(accountingBars(pack)).toEqual({
      baseline: 1,
      delivered: 0.3,
      reread: 0.1,
      scale: 10_000,
    });
    const costly = {
      baselineTokens: 1_000,
      deliveredTokens: 1_500,
      rereadTokens: 500,
    } as PackAccounting;
    expect(accountingBars(costly).baseline).toBeCloseTo(0.5);
  });
});

describe("prompt cache note", () => {
  it("says nothing for a new session and explains a lost cache", () => {
    expect(
      cacheNote({ loss: "NEW_SESSION", readTokens: 0, writeTokens: 20_000, lostTokens: null }),
    ).toBeNull();
    expect(
      cacheNote({ loss: "NONE", readTokens: 42_000, writeTokens: 300, lostTokens: 0 }),
    ).toMatchObject({ tone: "success" });
    const lost = cacheNote({
      loss: "EXPIRED",
      readTokens: 0,
      writeTokens: 42_000,
      lostTokens: 41_800,
    });
    expect(lost?.tone).toBe("warning");
    expect(lost?.text).toContain("cache expired during the pause");
    expect(lost?.text).toContain("ONYX_PROMPT_CACHE_TTL_MINUTES");
  });
});
