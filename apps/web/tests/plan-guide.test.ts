import { describe, expect, it } from "vitest";
import { translator } from "@/lib/i18n/core";
import { approvalOutcome, groupApprovals, NODE_STATE_HINTS, planBanner } from "@/lib/plan-guide";
import { renderGuide } from "@/lib/task-guide";

const it_ = translator("it");

function plan(status: Parameters<typeof planBanner>[0]["status"], states: string[] = []) {
  return {
    status,
    message: null,
    workBranch: "onyx/plan-cart",
    nodes: states.map((state) => ({ state: state as never })),
  };
}

describe("plan banner", () => {
  it("asks for approval when the plan is ready", () => {
    expect(planBanner(plan("AWAITING_APPROVAL")).actions).toEqual(["approve", "reject"]);
  });

  it("reports progress, or the decisions waiting for the operator", () => {
    const running = planBanner(plan("RUNNING", ["merged", "running", "pending"]));
    expect(running.actions).toEqual(["cancel"]);
    expect(renderGuide(running.detail!, it_)).toBe(
      "1 task su 3 uniti. Puoi seguire ogni task qui sotto.",
    );
    const deciding = planBanner(plan("RUNNING", ["conflict", "review", "merged"]));
    expect(deciding.tone).toBe("warning");
    expect(deciding.actions).toEqual(["approvals", "cancel"]);
    expect(renderGuide(deciding.title, it_)).toBe("2 task aspettano una tua decisione");
  });

  it("offers push, resume or nothing at the end", () => {
    expect(planBanner(plan("COMPLETED")).actions).toEqual(["push"]);
    expect(planBanner({ ...plan("FAILED"), message: "Claude could not plan" })).toMatchObject({
      actions: ["resume"],
      error: "Claude could not plan",
    });
    expect(planBanner({ ...plan("FAILED"), workBranch: null }).actions).toEqual([]);
    expect(planBanner(plan("CANCELLED")).actions).toEqual([]);
  });

  it("has a plain hint for every node state", () => {
    expect(Object.values(NODE_STATE_HINTS).every((hint) => it_(hint) !== hint)).toBe(true);
  });
});

describe("approvals", () => {
  it("says what approving and rejecting do", () => {
    expect(it_(approvalOutcome({ approveLabel: "Approve and run" }).approve)).toBe(
      "Se approvi, gli agenti partono sui task del piano, ognuno nel suo worktree.",
    );
    expect(approvalOutcome({ approveLabel: "Something new" }).reject).toBe(
      "If you reject, Onyx does not go ahead and nothing changes.",
    );
  });

  it("groups by kind in a stable order", () => {
    const groups = groupApprovals([
      { kind: "BUDGET" as const, id: "a" },
      { kind: "PLAN" as const, id: "b" },
      { kind: "BUDGET" as const, id: "c" },
    ]);
    expect(groups.map((group) => [group.kind, group.items.map((item) => item.id)])).toEqual([
      ["PLAN", ["b"]],
      ["BUDGET", ["a", "c"]],
    ]);
  });
});
