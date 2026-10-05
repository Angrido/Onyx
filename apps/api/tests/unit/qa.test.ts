import { describe, expect, it } from "vitest";
import { dagOutcome } from "../../src/domain/orchestration/dag";
import { conflictResolutionRow, qaReviewRow } from "../../src/domain/savings";
import {
  QA_MARKER,
  hasConflictMarkers,
  qaFeedbackPrompt,
  qaPrompt,
  readQaOutput,
  resolutionPrompt,
  truncateDiff,
} from "../../src/domain/qa";

const count = (text: string) => Math.ceil(text.length / 4);

function chunk(file: string, lines: number): string {
  return [
    `diff --git a/${file} b/${file}`,
    "index 1..2 100644",
    `--- a/${file}`,
    `+++ b/${file}`,
    "@@ -1 +1 @@",
    ...Array.from({ length: lines }, (_, index) => `+line ${index}`),
    "",
  ].join("\n");
}

describe("QA review", () => {
  it("keeps whole files under the budget and names the ones left out", () => {
    const diff = `${chunk("src/a.ts", 3)}${chunk("src/big.ts", 400)}${chunk("src/c.ts", 2)}`;
    const kept = truncateDiff(diff, 200, count);
    expect(kept.files).toEqual(["src/a.ts", "src/big.ts", "src/c.ts"]);
    expect(kept.truncated).toBe(true);
    expect(kept.text).toContain("+line 2");
    expect(kept.text).toContain("[diff of src/big.ts left out: too long, read the file instead]");
    expect(kept.text).not.toContain("+line 300");
    expect(kept.text).toContain("diff --git a/src/c.ts b/src/c.ts");
    expect(truncateDiff(chunk("x.ts", 1), 1000, count).truncated).toBe(false);
  });

  it("asks for evidence on numbered criteria", () => {
    const prompt = qaPrompt({
      title: "Fix",
      description: "Do it",
      acceptance: ["A works", "B works"],
      diff: truncateDiff(chunk("src/a.ts", 1), 1000, count),
      attempt: 2,
    });
    expect(prompt.startsWith(QA_MARKER)).toBe(true);
    expect(prompt).toContain("# Acceptance criteria\n1. A works\n2. B works");
    expect(prompt).toContain("Review attempt: 2.");
    expect(prompt).toContain("# Changed files\n- src/a.ts");
    expect(
      qaPrompt({
        title: "t",
        description: "d",
        acceptance: [],
        diff: truncateDiff("", 10, count),
        attempt: 1,
      }),
    ).toContain("(none: judge the change against the task description)");
  });

  it("passes only with every criterion met and cited from the diff", () => {
    const input = { acceptance: ["A works", "B works"], files: ["src/feature/a.ts"] };
    expect(
      readQaOutput(
        {
          verdict: "pass",
          summary: "Good",
          criteria: [
            { index: 1, met: true, evidence: "src/feature/a.ts:3 `return a`" },
            { index: 2, met: true, evidence: "a.ts:9 handles B" },
          ],
          issues: [],
        },
        input,
      ),
    ).toMatchObject({ verdict: "PASS", summary: "Good" });
    const weak = readQaOutput(
      {
        verdict: "pass",
        summary: "",
        criteria: [{ index: 1, met: true, evidence: "Seems fine" }],
        issues: [{ file: "", problem: "  " }, { problem: "Missing null check" }],
      },
      input,
    );
    expect(weak.verdict).toBe("FAIL");
    expect(weak.criteria).toEqual([
      { index: 1, text: "A works", met: false, evidence: "No evidence from the diff: Seems fine" },
      { index: 2, text: "B works", met: false, evidence: "Not reviewed" },
    ]);
    expect(weak.issues).toEqual([{ file: null, problem: "Missing null check" }]);
    expect(
      readQaOutput(
        { verdict: "fail", summary: "x", criteria: [], issues: [] },
        { acceptance: [], files: [] },
      ).verdict,
    ).toBe("FAIL");
    expect(() => readQaOutput({ verdict: "maybe" }, input)).toThrow(
      "The review returned no verdict",
    );
    expect(() => readQaOutput(null, input)).toThrow("The review returned no verdict");
  });

  it("turns a failed review into feedback for the agent", () => {
    const prompt = qaFeedbackPrompt({
      summary: "Almost",
      criteria: [
        { index: 1, text: "A works", met: true, evidence: "a.ts:1" },
        { index: 2, text: "B works", met: false, evidence: "Not reviewed" },
      ],
      issues: [{ file: "src/a.ts", problem: "Empty input crashes" }],
    });
    expect(prompt).toContain("Criteria not met:\n- 2. B works (Not reviewed)");
    expect(prompt).toContain("Issues:\n- src/a.ts: Empty input crashes");
    expect(prompt).not.toContain("1. A works");
    expect(prompt).toContain("Reviewer summary: Almost");
  });

  it("keeps a plan waiting while a node waits for a review decision", () => {
    expect(
      dagOutcome([
        { key: "a", dependsOn: [], state: "merged" },
        { key: "b", dependsOn: [], state: "review" },
      ]),
    ).toBe("waiting");
    expect(dagOutcome([{ key: "a", dependsOn: [], state: "reviewing" }])).toBe("running");
  });
});

describe("conflict resolution", () => {
  it("finds conflict markers only at the start of a line", () => {
    expect(hasConflictMarkers("a\n<<<<<<< HEAD\nb\n=======\nc\n>>>>>>> x\n")).toBe(true);
    expect(hasConflictMarkers("const arrow = '<<<<<<<';\n// ======= not a marker\n")).toBe(false);
    expect(hasConflictMarkers("=======\n")).toBe(true);
  });

  it("lists the files and what is already merged", () => {
    const prompt = resolutionPrompt({
      title: "Second label",
      description: "Set it",
      branch: "plan--second",
      workBranch: "plan",
      files: ["src/a.ts", "src/b.ts"],
      merged: ["First label"],
    });
    expect(prompt).toContain("# Conflicted files\n- src/a.ts\n- src/b.ts");
    expect(prompt).toContain("# Already on plan\n- First label");
    expect(prompt).toContain("Do not run commands and do not commit");
  });
});

describe("savings ledger", () => {
  it("shows QA as a measured cost, or as an estimate when unused", () => {
    expect(
      qaReviewRow({ reviews: 0, nodes: 0, caught: 0, fixed: 0, tokens: 0, usd: 0, windowDays: 30 }),
    ).toMatchObject({ source: "qa-review", evidence: "ESTIMATED", runs: 0 });
    const row = qaReviewRow({
      reviews: 5,
      nodes: 3,
      caught: 2,
      fixed: 1,
      tokens: 42_000,
      usd: 0.3,
      windowDays: 30,
    });
    expect(row).toMatchObject({ evidence: "MEASURED", tokens: null, runs: 5 });
    expect(row.detail).toBe(
      "A cost, not a saving: 5 reviews of 3 tasks used 42.0k tokens ($0.300) in the last 30 days. They found problems in 2 tasks before the merge, and the agent fixed 1 of them after the review. The rework this avoids after the merge is not measured.",
    );
  });

  it("counts conflict proposals by outcome", () => {
    const row = conflictResolutionRow({
      proposals: 3,
      applied: 1,
      unusable: 1,
      refused: 1,
      usd: 0.05,
      windowDays: 30,
    });
    expect(row).toMatchObject({ source: "conflict-resolution", evidence: "MEASURED", runs: 3 });
    expect(row.detail).toContain("3 conflicts handed to Claude for $0.050");
    expect(
      conflictResolutionRow({
        proposals: 0,
        applied: 0,
        unusable: 0,
        refused: 0,
        usd: 0,
        windowDays: 30,
      }).evidence,
    ).toBe("ESTIMATED");
  });
});
