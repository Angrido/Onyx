import { describe, expect, it } from "vitest";
import { describeMatcher, scorePosition, splitList, topComponents, weightSum } from "@/lib/router";

describe("router helpers", () => {
  it("describes a matcher in plain words", () => {
    expect(describeMatcher({})).toBe("Every task");
    expect(
      describeMatcher({
        taskKinds: ["UI_STYLE"],
        workspaceDomains: ["FRONTEND"],
        pathGlobs: ["apps/web/**"],
        maxFilesTouched: 3,
        styleOnly: true,
      }),
    ).toBe("UI / styling · Frontend · paths apps/web/** · ≤ 3 files · style files only");
  });

  it("splits comma and newline lists without duplicates", () => {
    expect(splitList("a, b\nb,, c ")).toEqual(["a", "b", "c"]);
  });

  it("sums weights and ranks score components", () => {
    const weights = {
      blastRadius: 0.3,
      crossDomain: 0.2,
      filesTouched: 0.15,
      archKeywords: 0.15,
      contextTokens: 0.1,
      priorFailures: 0.1,
    };
    expect(weightSum(weights)).toBe(1);
    expect(
      topComponents({ ...weights, blastRadius: 0, crossDomain: 0.2, archKeywords: 0.15 }, 2),
    ).toEqual([
      { key: "crossDomain", value: 0.2 },
      { key: "filesTouched", value: 0.15 },
    ]);
  });

  it("clamps score positions", () => {
    expect(scorePosition(0.5, 1)).toBe(50);
    expect(scorePosition(2, 1)).toBe(100);
    expect(scorePosition(1, 0)).toBe(0);
  });
});
