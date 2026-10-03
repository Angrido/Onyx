import type { TddLoopDto } from "@onyx/contracts";
import { describe, expect, it } from "vitest";
import { attemptsLabel, isLoopActive, iterationOutcome, runnerLabel, upsertLoop } from "@/lib/tdd";

function loop(id: string, createdAt: string, status: TddLoopDto["status"] = "RUNNING"): TddLoopDto {
  return {
    id,
    taskId: "task",
    projectId: "project",
    workspaceId: "workspace",
    workspaceName: "Backend",
    terminalId: `tdd-${id}`,
    runner: "VITEST",
    relatedCommand: "",
    fullCommand: "",
    gates: { typecheck: null, lint: null },
    relatedFiles: [],
    maxIterations: 6,
    budgetUsd: null,
    testTimeoutSec: 300,
    status,
    phase: null,
    iterationCount: 2,
    violations: 0,
    protectedFiles: 3,
    costUsd: 0,
    message: null,
    escalatedAt: null,
    createdAt,
    startedAt: createdAt,
    endedAt: null,
    greenAt: null,
    iterations: [],
  };
}

describe("TDD loop helpers", () => {
  it("keeps the newest loop first and replaces updated loops", () => {
    const older = loop("a", "2026-10-03T10:00:00.000Z");
    const newer = loop("b", "2026-10-03T11:00:00.000Z");
    const list = upsertLoop([older], newer);
    expect(list.map((entry) => entry.id)).toEqual(["b", "a"]);
    const finished = upsertLoop(list, { ...older, status: "GREEN" });
    expect(finished.map((entry) => [entry.id, entry.status])).toEqual([
      ["b", "RUNNING"],
      ["a", "GREEN"],
    ]);
  });

  it("describes loops and iterations", () => {
    expect(isLoopActive({ status: "RUNNING" })).toBe(true);
    expect(isLoopActive({ status: "STALLED" })).toBe(false);
    expect(attemptsLabel({ iterationCount: 2, maxIterations: 6 })).toBe("2/6");
    expect(iterationOutcome({ scope: "related", failed: 3 })).toBe("red");
    expect(iterationOutcome({ scope: "full", failed: 0 })).toBe("green");
    expect(iterationOutcome({ scope: "guard", failed: 1 })).toBe("reverted");
    expect(runnerLabel("JEST")).toBe("Jest");
    expect(runnerLabel(null)).toBe("none found");
  });
});
