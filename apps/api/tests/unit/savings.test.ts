import type { PackAccounting } from "@onyx/contracts";
import { describe, expect, it } from "vitest";
import {
  armStats,
  auditReads,
  compareArms,
  DEFAULT_EXPERIMENT,
  drawArm,
  mannWhitneyP,
  median,
  normalCdf,
  savingRatio,
  savingsChecks,
  savingsVerdict,
  quotaRow,
  stackCommandsRow,
  type ArmSample,
} from "../../src/domain/savings";

function sample(contextTokens: number, completed = true): ArmSample {
  return {
    completed,
    contextTokens,
    outputTokens: 500,
    costUsd: contextTokens / 100_000,
    turns: 4,
    readFiles: 3,
  };
}

function accounting(overrides: Partial<PackAccounting> = {}): PackAccounting {
  return {
    windowDays: 30,
    runs: 12,
    runsWithPack: 10,
    controlRuns: 0,
    baselineTokens: 100_000,
    deliveredTokens: 30_000,
    rereadTokens: 10_000,
    grossSaving: 0.7,
    netSaving: 0.6,
    runsWithRereads: 3,
    rereadFiles: 4,
    readFiles: 20,
    missedFiles: 2,
    expansions: 1,
    topRereads: [{ relPath: "src/a.ts", runs: 3 }],
    ...overrides,
  };
}

describe("experiment arms", () => {
  it("draws an arm only for fresh sessions while the experiment is on", () => {
    const on = { enabled: true, controlShare: 0.25, variant: null };
    const base = { settings: on, freshSession: true, contextEnabled: true };
    expect(drawArm({ ...base, random: () => 0.1 })).toBe("CONTROL");
    expect(drawArm({ ...base, random: () => 0.9 })).toBe("PACK");
    expect(drawArm({ ...base, freshSession: false, random: () => 0.1 })).toBeNull();
    expect(drawArm({ ...base, contextEnabled: false, random: () => 0.1 })).toBeNull();
    expect(drawArm({ ...base, settings: DEFAULT_EXPERIMENT, random: () => 0.1 })).toBeNull();
    const three = { ...base, settings: { ...on, variant: "TARGET_L2" as const } };
    expect(drawArm({ ...three, random: () => 0.1 })).toBe("CONTROL");
    expect(drawArm({ ...three, random: () => 0.5 })).toBe("PACK");
    expect(drawArm({ ...three, random: () => 0.7 })).toBe("TARGET_L2");
  });

  it("compares the variant with the current pack", () => {
    const sample = (contextTokens: number): ArmSample => ({
      completed: true,
      contextTokens,
      outputTokens: 100,
      costUsd: 0.01,
      turns: 3,
      readFiles: 2,
    });
    const settings = { enabled: true, controlShare: 0.2, variant: "TARGET_L2" as const };
    const result = compareArms({
      settings,
      pack: Array.from({ length: 12 }, (_, index) => sample(10_000 + index)),
      control: Array.from({ length: 12 }, (_, index) => sample(14_000 + index)),
      variant: Array.from({ length: 12 }, (_, index) => sample(8_000 + index)),
      windowDays: 90,
      since: null,
    });
    expect(result.state).toBe("SAVING");
    expect(result.variant?.runs).toBe(12);
    expect(result.variantState).toBe("SAVING");
    expect(result.variantTokenChange).toBeCloseTo(-0.2, 2);
    const without = compareArms({
      ...{ settings: { ...settings, variant: null } },
      pack: [],
      control: [],
      windowDays: 90,
      since: null,
    });
    expect(without.variant).toBeNull();
    expect(without.variantState).toBe("OFF");
  });
});

describe("read audit", () => {
  const entries = [
    { relPath: "src/target.ts", role: "target" as const },
    { relPath: "src/dep.ts", role: "dependency" as const },
    { relPath: "src/user.ts", role: "dependent" as const },
    { relPath: "src/near.ts", role: "nearby" as const },
  ];

  it("counts reads of baseline files as re-reads and unknown files as misses", () => {
    const audit = auditReads(
      [
        { relPath: "src/target.ts", tokens: 800 },
        { relPath: "src/target.ts", tokens: 800 },
        { relPath: "src/dep.ts", tokens: 300 },
        { relPath: "src/user.ts", tokens: 900 },
        { relPath: "src/other.ts", tokens: 400 },
      ],
      entries,
    );
    expect(audit).toEqual({
      readFiles: 4,
      rereadFiles: 2,
      rereadTokens: 1_900,
      missedFiles: 1,
      rereadPaths: ["src/dep.ts", "src/target.ts"],
    });
  });

  it("treats every read as a miss when there is no pack", () => {
    expect(auditReads([{ relPath: "src/a.ts", tokens: 10 }], [])).toMatchObject({
      readFiles: 1,
      rereadFiles: 0,
      missedFiles: 1,
    });
  });

  it("subtracts re-reads from the saving", () => {
    expect(savingRatio(10_000, 4_000)).toBeCloseTo(0.6);
    expect(savingRatio(10_000, 12_000)).toBeCloseTo(-0.2);
    expect(savingRatio(0, 100)).toBeNull();
  });
});

describe("statistics", () => {
  it("computes medians", () => {
    expect(median([])).toBeNull();
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });

  it("approximates the normal distribution", () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 6);
    expect(normalCdf(1.96)).toBeCloseTo(0.975, 3);
    expect(normalCdf(-1.96)).toBeCloseTo(0.025, 3);
  });

  it("matches the asymptotic Mann-Whitney test", () => {
    const low = Array.from({ length: 10 }, (_, index) => index + 1);
    const high = Array.from({ length: 10 }, (_, index) => index + 11);
    expect(mannWhitneyP(low, high)).toBeCloseTo(0.000183, 5);
    expect(mannWhitneyP([1, 2, 3], [1, 2, 3])).toBe(1);
    expect(mannWhitneyP([], [1])).toBeNull();
    const tied = mannWhitneyP([1, 1, 2, 2, 2], [2, 3, 3, 3, 4]);
    expect(tied).toBeGreaterThan(0);
    expect(tied).toBeLessThan(0.05);
  });

  it("summarizes an arm", () => {
    const stats = armStats("PACK", [sample(10_000), sample(30_000, false), sample(20_000)]);
    expect(stats).toMatchObject({
      runs: 3,
      completed: 2,
      medianContextTokens: 20_000,
      medianCostUsd: 0.2,
      medianTurns: 4,
    });
    expect(stats.successRate).toBeCloseTo(2 / 3);
    expect(stats.totalCostUsd).toBeCloseTo(0.6);
  });
});

describe("experiment verdict", () => {
  const on = { enabled: true, controlShare: 0.3, variant: null };
  const pack = Array.from({ length: 12 }, (_, index) => sample(20_000 + index * 500));
  const control = Array.from({ length: 12 }, (_, index) => sample(40_000 + index * 500));

  it("waits for enough runs in both arms", () => {
    const result = compareArms({
      settings: on,
      pack: pack.slice(0, 4),
      control: control.slice(0, 2),
      windowDays: 90,
      since: null,
    });
    expect(result.state).toBe("COLLECTING");
    const verdict = savingsVerdict(result, accounting());
    expect(verdict.state).toBe("COLLECTING");
    expect(verdict.headline).toContain("2 of 10");
    expect(verdict.detail).toContain("estimated 60% fewer");
  });

  it("confirms a significant saving", () => {
    const result = compareArms({ settings: on, pack, control, windowDays: 90, since: null });
    expect(result.state).toBe("SAVING");
    expect(result.tokenChange).toBeCloseTo(22_750 / 42_750 - 1);
    expect(result.pValue).toBeLessThan(0.001);
    const verdict = savingsVerdict(result, accounting());
    expect(verdict.state).toBe("CONFIRMED");
    expect(verdict.headline).toBe(
      "Measured: runs with the Onyx context use 47% fewer input tokens",
    );
  });

  it("flags a context that costs more", () => {
    const result = compareArms({
      settings: on,
      pack: control,
      control: pack,
      windowDays: 90,
      since: null,
    });
    expect(result.state).toBe("COSTS_MORE");
    expect(savingsVerdict(result, accounting()).state).toBe("NOT_PAYING");
  });

  it("does not call noise a saving", () => {
    const noisy = (offset: number) =>
      Array.from({ length: 12 }, (_, index) =>
        sample(20_000 + ((index * 7919) % 13) * 1_000 + offset),
      );
    const result = compareArms({
      settings: on,
      pack: noisy(0),
      control: noisy(300),
      windowDays: 90,
      since: null,
    });
    expect(result.state).toBe("NO_DIFFERENCE");
    expect(savingsVerdict(result, accounting()).state).toBe("NO_DIFFERENCE");
  });

  it("warns when fewer runs succeed with the context", () => {
    const failing = pack.map((entry, index) => ({ ...entry, completed: index % 2 === 0 }));
    const result = compareArms({
      settings: on,
      pack: failing,
      control,
      windowDays: 90,
      since: null,
    });
    expect(savingsVerdict(result, accounting()).detail).toContain("50% fewer runs succeed");
  });

  it("falls back to the estimate when the experiment is off", () => {
    const off = compareArms({
      settings: DEFAULT_EXPERIMENT,
      pack: [],
      control: [],
      windowDays: 90,
      since: null,
    });
    expect(off.state).toBe("OFF");
    expect(savingsVerdict(off, accounting()).state).toBe("ESTIMATE_ONLY");
    expect(savingsVerdict(off, accounting()).headline).toBe(
      "Estimated 60% fewer context tokens, not measured",
    );
    expect(savingsVerdict(off, accounting({ netSaving: -0.1 })).headline).toBe(
      "Estimated: the context pack saves nothing",
    );
    expect(savingsVerdict(off, accounting({ runsWithPack: 0 })).state).toBe("NO_DATA");
  });
});

describe("health checks", () => {
  const off = compareArms({
    settings: DEFAULT_EXPERIMENT,
    pack: [],
    control: [],
    windowDays: 90,
    since: null,
  });

  it("reports a healthy pack and an unmeasured saving", () => {
    const checks = savingsChecks({ contextEnabled: true, pack: accounting(), experiment: off });
    expect(checks.map((check) => [check.id, check.state])).toEqual([
      ["context", "ok"],
      ["coverage", "ok"],
      ["rereads", "ok"],
      ["net", "ok"],
      ["experiment", "warn"],
    ]);
  });

  it("explains what is wrong", () => {
    const checks = savingsChecks({
      contextEnabled: false,
      pack: accounting({
        runsWithPack: 3,
        grossSaving: 0.5,
        netSaving: -0.05,
        rereadTokens: 55_000,
      }),
      experiment: off,
    });
    const byId = Object.fromEntries(checks.map((check) => [check.id, check]));
    expect(byId["context"]?.state).toBe("fail");
    expect(byId["coverage"]?.state).toBe("warn");
    expect(byId["rereads"]?.state).toBe("warn");
    expect(byId["rereads"]?.detail).toContain("Most re-read: src/a.ts");
    expect(byId["net"]?.state).toBe("fail");
  });

  it("stays idle without runs", () => {
    const checks = savingsChecks({
      contextEnabled: true,
      pack: accounting({
        runs: 0,
        runsWithPack: 0,
        baselineTokens: 0,
        grossSaving: null,
        netSaving: null,
      }),
      experiment: off,
    });
    expect(checks.filter((check) => check.state === "idle").map((check) => check.id)).toEqual([
      "coverage",
      "rereads",
      "net",
    ]);
  });
});

describe("ledger rows of milestone 2", () => {
  it("counts the drop in continuation runs as an estimated saving", () => {
    expect(
      stackCommandsRow({
        current: { runs: 1, tokens: 12_000 },
        previous: { runs: 4, tokens: 60_000 },
        windowDays: 30,
      }),
    ).toMatchObject({ source: "stack-commands", evidence: "ESTIMATED", tokens: 48_000, runs: 1 });
    expect(
      stackCommandsRow({
        current: { runs: 3, tokens: 50_000 },
        previous: { runs: 0, tokens: 0 },
        windowDays: 30,
      }).tokens,
    ).toBeNull();
    expect(
      stackCommandsRow({
        current: { runs: 0, tokens: 0 },
        previous: { runs: 0, tokens: 0 },
        windowDays: 30,
      }).detail,
    ).toBe("No run had to continue after a refused command in the last 60 days.");
  });

  it("measures held runs without claiming tokens", () => {
    expect(quotaRow({ deferredRuns: 2, limitedRuns: 1, windowDays: 30 })).toMatchObject({
      source: "quota",
      evidence: "MEASURED",
      tokens: null,
      runs: 2,
    });
  });
});
