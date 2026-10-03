import type { ApprovalDto, OrchestrationDto, OrchestrationNode } from "@onyx/contracts";
import { describe, expect, it } from "vitest";
import { formatBytes } from "@/lib/format";
import {
  budgetUsage,
  canResume,
  isPlanActive,
  isPlanOpen,
  planLevels,
  planProgress,
  sortApprovals,
  upsertPlan,
} from "@/lib/orchestration";

function node(key: string, level: number, state: OrchestrationNode["state"]): OrchestrationNode {
  return {
    taskId: `task-${key}`,
    key,
    title: key,
    description: "",
    kind: "FEATURE",
    tier: null,
    workspaceId: null,
    workspaceName: null,
    dependsOn: [],
    level,
    targetPaths: [],
    acceptance: [],
    state,
    taskStatus: "DRAFT",
    branch: null,
    worktreePath: null,
    mergeCommit: null,
    mergedAt: null,
    startedAt: null,
    completedAt: null,
    costUsd: 0,
    runs: 0,
    lastModelId: null,
    tddLoopId: null,
    message: null,
  };
}

function plan(id: string, createdAt: string, status: OrchestrationDto["status"]): OrchestrationDto {
  return {
    id,
    projectId: "project",
    rootTaskId: `root-${id}`,
    status,
    goal: "goal",
    summary: null,
    warnings: [],
    baseBranch: null,
    baseCommit: null,
    workBranch: status === "FAILED" ? "onyx/plan" : null,
    parallelism: 2,
    verify: true,
    plannerModelId: null,
    plannerCostUsd: null,
    costUsd: 0,
    message: null,
    activity: null,
    approvalId: null,
    verifyLoopId: null,
    createdAt,
    approvedAt: null,
    startedAt: null,
    endedAt: null,
    nodes: [],
  };
}

function approval(id: string, status: ApprovalDto["status"], createdAt: string): ApprovalDto {
  return {
    id,
    kind: "PLAN",
    status,
    title: id,
    detail: null,
    projectId: null,
    projectName: null,
    taskId: null,
    orchestrationId: null,
    link: null,
    files: [],
    approveLabel: "Approve",
    rejectLabel: "Reject",
    decidedBy: null,
    note: null,
    createdAt,
    decidedAt: null,
  };
}

describe("plan helpers", () => {
  it("groups nodes by level and measures progress", () => {
    const nodes = [node("a", 0, "merged"), node("b", 0, "running"), node("c", 2, "pending")];
    expect(planLevels(nodes).map((level) => level.map((entry) => entry.key))).toEqual([
      ["a", "b"],
      ["c"],
    ]);
    expect(planProgress(nodes)).toEqual({ merged: 1, total: 3, ratio: 1 / 3 });
    expect(planProgress([])).toEqual({ merged: 0, total: 0, ratio: 0 });
  });

  it("knows which plans are live, open or resumable", () => {
    expect(isPlanActive(plan("a", "2026-10-01", "VERIFYING"))).toBe(true);
    expect(isPlanActive(plan("a", "2026-10-01", "AWAITING_APPROVAL"))).toBe(false);
    expect(isPlanOpen(plan("a", "2026-10-01", "AWAITING_APPROVAL"))).toBe(true);
    expect(canResume(plan("a", "2026-10-01", "FAILED"))).toBe(true);
    expect(canResume(plan("a", "2026-10-01", "CANCELLED"))).toBe(false);
  });

  it("keeps the newest plans first when updates arrive", () => {
    const list = [plan("old", "2026-10-01", "COMPLETED"), plan("mid", "2026-10-02", "RUNNING")];
    const updated = upsertPlan(list, plan("mid", "2026-10-02", "COMPLETED"));
    expect(updated.map((entry) => [entry.id, entry.status])).toEqual([
      ["mid", "COMPLETED"],
      ["old", "COMPLETED"],
    ]);
    expect(upsertPlan(updated, plan("new", "2026-10-03", "PLANNING"))[0]?.id).toBe("new");
  });
});

describe("approvals and budgets", () => {
  it("lists pending approvals first, newest first", () => {
    const sorted = sortApprovals([
      approval("done", "APPROVED", "2026-10-03"),
      approval("older", "PENDING", "2026-10-01"),
      approval("newer", "PENDING", "2026-10-02"),
    ]);
    expect(sorted.map((entry) => entry.id)).toEqual(["newer", "older", "done"]);
  });

  it("measures spend against the hard limit", () => {
    expect(budgetUsage({ spentUsd: 5, softUsd: 4, hardUsd: 10 })).toEqual({
      ratio: 0.5,
      softRatio: 0.4,
    });
    expect(budgetUsage({ spentUsd: 15, softUsd: null, hardUsd: 10 })).toEqual({
      ratio: 1,
      softRatio: null,
    });
  });
});

describe("sizes", () => {
  it("formats backup sizes", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(3_276_800)).toBe("3.1 MB");
    expect(formatBytes(5 * 1024 ** 3)).toBe("5.00 GB");
  });
});
