import { describe, expect, it } from "vitest";
import { batchPrompt, isSmallTask, parseBatchOutcome } from "../../src/domain/batch";

const small = {
  kind: "BUGFIX",
  prompt: "Fix the label",
  targetPaths: ["a.ts"],
  worktreePath: null,
  parentTaskId: null,
};

describe("small task batching", () => {
  it("only groups short, independent tasks", () => {
    expect(isSmallTask(small)).toBe(true);
    expect(isSmallTask({ ...small, kind: "ARCHITECTURE" })).toBe(false);
    expect(isSmallTask({ ...small, prompt: "x".repeat(601) })).toBe(false);
    expect(isSmallTask({ ...small, targetPaths: ["a", "b", "c"] })).toBe(false);
    expect(isSmallTask({ ...small, worktreePath: "/w" })).toBe(false);
    expect(isSmallTask({ ...small, parentTaskId: "p" })).toBe(false);
  });

  it("numbers the tasks and asks for one outcome line each", () => {
    const prompt = batchPrompt([
      { title: "Label", prompt: "Fix the label", acceptance: ["Says Save"], targetPaths: ["a.ts"] },
      { title: "Typo", prompt: "Fix the typo", acceptance: [], targetPaths: [] },
    ]);
    expect(prompt).toContain("# 2 small tasks");
    expect(prompt).toContain(
      "## Task 1: Label\n\nFix the label\n\nAcceptance criteria:\n- Says Save\n\nFiles: a.ts",
    );
    expect(prompt).toContain("## Task 2: Typo\n\nFix the typo");
    expect(prompt).toContain("`TASK <number>: DONE`");
  });

  it("reads the outcome of each task and notices the missing ones", () => {
    expect(
      parseBatchOutcome(
        "Done.\nTASK 1: DONE\n**TASK 3: FAILED** the file is generated\ntask 9: DONE",
        3,
      ),
    ).toEqual([
      { status: "DONE" },
      { status: "MISSING" },
      { status: "FAILED", reason: "the file is generated" },
    ]);
    expect(parseBatchOutcome(null, 2)).toEqual([{ status: "MISSING" }, { status: "MISSING" }]);
    expect(parseBatchOutcome("TASK 1: FAILED", 1)).toEqual([
      { status: "FAILED", reason: "Reported as failed" },
    ]);
  });
});
