import type { RunItemOf } from "@onyx/contracts";
import { describe, expect, it } from "vitest";
import { CONCISE_GUIDE, composePrimer } from "../../src/domain/context-primer";
import { costOfModel, usageByModel } from "../../src/domain/exploration";
import { batchingRow, conciseRow, explorationRow } from "../../src/domain/savings";

const USAGE = { inputTokens: 10, outputTokens: 2, cacheCreationTokens: 0, cacheReadTokens: 0 };

function result(modelUsage: RunItemOf<"result">["modelUsage"]): RunItemOf<"result"> {
  return {
    kind: "result",
    subtype: "success",
    isError: false,
    numTurns: 2,
    durationMs: 1,
    durationApiMs: 1,
    costUsd: 0.01,
    usage: USAGE,
    resultText: "ok",
    sessionId: null,
    modelUsage,
  };
}

describe("cheap exploration", () => {
  it("splits usage per model and finds the planner's share", () => {
    const rows = usageByModel(
      result({
        "claude-opus-5-5": { usage: USAGE, costUsd: 0.008 },
        "claude-haiku-4-5": { usage: USAGE, costUsd: 0.002 },
      }),
      "claude-opus-5-5",
    );
    expect(rows.map((row) => row.modelId)).toEqual(["claude-opus-5-5", "claude-haiku-4-5"]);
    expect(costOfModel(rows, "claude-opus-5-5")).toBe(0.008);
    const single = usageByModel(result({}), "claude-opus-5-5");
    expect(single).toEqual([{ modelId: "claude-opus-5-5", usage: USAGE, costUsd: 0.01 }]);
    expect(costOfModel(single, "claude-sonnet-5-5")).toBe(0.01);
  });
});

describe("short final summaries", () => {
  it("are asked only when chosen", () => {
    const base = {
      workspacePrimer: null,
      agentPrompt: null,
      projectName: "shop",
      map: null,
      mcpEnabled: false,
    };
    expect(composePrimer({ ...base, concise: true })).toBe(CONCISE_GUIDE);
    expect(composePrimer(base)).toBe("");
  });
});

describe("ledger rows for the options", () => {
  it("measures summaries before and after once there are enough runs", () => {
    const many = (value: number) => Array.from({ length: 12 }, () => value);
    expect(
      conciseRow({
        enabled: true,
        since: "2026-10-01T00:00:00Z",
        before: many(1000),
        after: many(700),
        windowDays: 30,
      }),
    ).toMatchObject({ evidence: "MEASURED" });
    expect(
      conciseRow({
        enabled: true,
        since: "2026-10-01T00:00:00Z",
        before: many(1000),
        after: [500],
        windowDays: 30,
      }).detail,
    ).toContain("now 12 and 1");
    expect(
      conciseRow({ enabled: false, since: null, before: [], after: [], windowDays: 30 }).detail,
    ).toContain("Off");
  });

  it("compares plans with and without the explorer", () => {
    const row = explorationRow({
      enabled: true,
      withExplorer: [0.02, 0.03, 0.025],
      without: [0.05, 0.06, 0.04],
    });
    expect(row.evidence).toBe("MEASURED");
    expect(row.detail).toContain("-50%");
    expect(explorationRow({ enabled: true, withExplorer: [0.02], without: [] }).evidence).toBe(
      "ESTIMATED",
    );
  });

  it("counts tokens per completed small task", () => {
    const row = batchingRow({
      enabled: true,
      batched: { runs: 5, tokens: 30_000, tasks: 15 },
      single: { runs: 6, tokens: 18_000, tasks: 6 },
    });
    expect(row).toMatchObject({ evidence: "MEASURED", tokens: 15_000 });
    expect(
      batchingRow({
        enabled: false,
        batched: { runs: 0, tokens: 0, tasks: 0 },
        single: { runs: 0, tokens: 0, tasks: 0 },
      }).detail,
    ).toContain("Off");
  });
});
