import type { GitSummary } from "@onyx/contracts";
import { describe, expect, it } from "vitest";
import { mapLimited, projectHealth } from "../../src/domain/mission";

const GIT: GitSummary = {
  isRepo: true,
  branch: "main",
  upstream: "origin/main",
  ahead: 0,
  behind: 0,
  changeCount: 0,
  checkedAt: "2026-10-04T10:00:00.000Z",
  error: null,
};

describe("project health", () => {
  it("is fine with nothing to report", () => {
    expect(
      projectHealth({
        indexError: null,
        git: GIT,
        lastRun: null,
        lastTdd: null,
        pendingApprovals: 0,
      }),
    ).toEqual({ health: "OK", reasons: [] });
  });

  it("asks for attention and lists errors first", () => {
    expect(
      projectHealth({
        indexError: null,
        git: { ...GIT, behind: 2 },
        lastRun: { status: "FAILED" },
        lastTdd: { status: "EXHAUSTED" },
        pendingApprovals: 1,
      }),
    ).toEqual({
      health: "ATTENTION",
      reasons: [
        "The last run failed",
        "The last TDD loop did not reach green",
        "1 approval waiting",
        "2 commits behind origin/main",
      ],
    });
    const broken = projectHealth({
      indexError: "parse error",
      git: { ...GIT, isRepo: false, error: "fatal: bad object" },
      lastRun: { status: "INTERRUPTED" },
      lastTdd: { status: "GREEN" },
      pendingApprovals: 0,
    });
    expect(broken.health).toBe("ERROR");
    expect(broken.reasons).toEqual([
      "The code index failed: parse error",
      "Git could not read the project: fatal: bad object",
      "The last run was interrupted",
    ]);
  });

  it("flags a folder that is not a repository", () => {
    expect(
      projectHealth({
        indexError: null,
        git: { ...GIT, isRepo: false },
        lastRun: { status: "COMPLETED" },
        lastTdd: null,
        pendingApprovals: 0,
      }),
    ).toEqual({ health: "ATTENTION", reasons: ["Not a git repository"] });
  });
});

describe("bounded concurrency", () => {
  it("keeps the order and never runs more than the limit at once", async () => {
    let running = 0;
    let peak = 0;
    const result = await mapLimited([5, 1, 4, 2, 3], 2, async (value) => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, value));
      running -= 1;
      return value * 10;
    });
    expect(result).toEqual([50, 10, 40, 20, 30]);
    expect(peak).toBe(2);
    expect(await mapLimited([], 3, async () => 1)).toEqual([]);
  });
});
