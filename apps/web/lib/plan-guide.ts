import type { ApprovalDto, ApprovalKind, NodeStateName, OrchestrationDto } from "@onyx/contracts";
import { msg } from "@/lib/i18n/core";
import type { Banner, GuideText } from "@/lib/task-guide";

export type PlanAction = "approve" | "reject" | "resume" | "cancel" | "push" | "approvals";

export const NODE_STATE_HINTS: Record<NodeStateName, string> = {
  pending: msg("Starts when the tasks before it are merged and an agent is free."),
  running: msg("An agent is working on it in its own worktree."),
  verifying: msg("Onyx is running the tests on its changes."),
  reviewing: msg("The QA reviewer is checking the changes."),
  review: msg("QA found problems: decide in Approvals."),
  merging: msg("Its changes are being merged into the work branch."),
  merged: msg("Its changes are on the work branch."),
  conflict: msg("Its changes clash with another task: decide in Approvals."),
  failed: msg("It did not finish: open the task to see why."),
  blocked: msg("It cannot start because a task it depends on did not finish."),
  cancelled: msg("It will not run."),
};

const DECIDING: ReadonlySet<NodeStateName> = new Set(["conflict", "review"]);

function text(key: string, params?: GuideText["params"]): GuideText {
  return params ? { key, params } : { key };
}

function banner(
  tone: Banner<PlanAction>["tone"],
  title: GuideText,
  detail: GuideText | null,
  actions: PlanAction[],
  extra: Partial<Pick<Banner<PlanAction>, "busy" | "hint" | "error">> = {},
): Banner<PlanAction> {
  return {
    tone,
    busy: extra.busy ?? false,
    title,
    detail,
    hint: extra.hint ?? null,
    error: extra.error ?? null,
    actions,
  };
}

type PlanFacts = Pick<OrchestrationDto, "status" | "message" | "workBranch"> & {
  nodes: ReadonlyArray<{ state: NodeStateName }>;
};

export function planBanner(plan: PlanFacts): Banner<PlanAction> {
  const total = plan.nodes.length;
  const merged = plan.nodes.filter((node) => node.state === "merged").length;
  const deciding = plan.nodes.filter((node) => DECIDING.has(node.state)).length;
  const branch = plan.workBranch ?? "";
  switch (plan.status) {
    case "PLANNING":
      return banner(
        "info",
        text(msg("Claude is planning the feature")),
        text(
          msg(
            "It reads the project without changing anything and splits the work into small tasks. It takes a few minutes.",
          ),
        ),
        ["cancel"],
        { busy: true },
      );
    case "AWAITING_APPROVAL":
      return banner(
        "warning",
        text(msg("The plan is ready and needs your approval")),
        text(
          msg(
            "Read the tasks below. Nothing runs until you approve; then each task gets its own worktree.",
          ),
        ),
        ["approve", "reject"],
      );
    case "RUNNING":
      if (deciding > 0)
        return banner(
          "warning",
          deciding === 1
            ? text(msg("1 task needs your decision"))
            : text(msg("{count} tasks need your decision"), { count: deciding }),
          text(msg("A merge conflict or a QA problem is waiting for you in Approvals.")),
          ["approvals", "cancel"],
        );
      return banner(
        "info",
        text(msg("Agents are working on the plan")),
        text(msg("{merged} of {total} tasks merged. You can follow each task below."), {
          merged,
          total,
        }),
        ["cancel"],
        { busy: true },
      );
    case "VERIFYING":
      return banner(
        "info",
        text(msg("Final tests on the merged branch")),
        text(msg("Onyx runs the whole suite and the type check on {branch}."), { branch }),
        ["cancel"],
        { busy: true },
      );
    case "COMPLETED":
      return banner(
        "success",
        text(msg("Plan finished: everything is merged")),
        branch
          ? text(msg("All the work is on {branch}. Push it and open a pull request when ready."), {
              branch,
            })
          : null,
        branch ? ["push"] : [],
      );
    case "FAILED":
      return banner(
        "danger",
        text(msg("The plan stopped")),
        branch ? text(msg("Fix the cause, then resume: the tasks already merged are kept.")) : null,
        branch ? ["resume"] : [],
        { error: plan.message },
      );
    case "CANCELLED":
      return banner(
        "neutral",
        text(msg("Plan cancelled")),
        branch
          ? text(msg("No more tasks start. What was already merged stays on {branch}."), {
              branch,
            })
          : text(msg("No more tasks start.")),
        [],
      );
  }
}

interface Outcome {
  approve: string;
  reject: string;
}

const OUTCOMES_BY_LABEL: Record<string, Outcome> = {
  "Approve and run": {
    approve: msg(
      "If you approve, agents start on the tasks of the plan, each in its own worktree.",
    ),
    reject: msg("If you reject, the plan is discarded and no file changes."),
  },
  "Merge anyway": {
    approve: msg("If you approve, the task is merged into the work branch despite the problems."),
    reject: msg("If you reject, the task is dropped and its changes are not merged."),
  },
  "Retry the merge": {
    approve: msg(
      "If you approve, Onyx tries the merge again: fix the conflict on the task branch first.",
    ),
    reject: msg("If you reject, the task is dropped and its changes are not merged."),
  },
  "Apply the resolution": {
    approve: msg("If you approve, Claude's resolution is applied and the task is merged."),
    reject: msg("If you reject, the resolution is discarded and you fix the conflict yourself."),
  },
  "Continue this period": {
    approve: msg(
      "If you approve, the waiting runs start and spending can go up to the hard limit.",
    ),
    reject: msg("If you reject, runs stay paused until the next period or a higher budget."),
  },
};

const GENERIC_OUTCOME: Outcome = {
  approve: msg("If you approve, Onyx goes ahead as described above."),
  reject: msg("If you reject, Onyx does not go ahead and nothing changes."),
};

export function approvalOutcome(approval: Pick<ApprovalDto, "approveLabel">): Outcome {
  return OUTCOMES_BY_LABEL[approval.approveLabel] ?? GENERIC_OUTCOME;
}

export const APPROVAL_GROUP_TITLES: Record<ApprovalKind, string> = {
  PLAN: msg("Plans to start"),
  QA: msg("QA problems"),
  MERGE: msg("Merge conflicts"),
  BUDGET: msg("Budgets"),
  ESCALATION: msg("Stronger models"),
  PERMISSION: msg("Permissions"),
};

const GROUP_ORDER: readonly ApprovalKind[] = [
  "PLAN",
  "QA",
  "MERGE",
  "BUDGET",
  "ESCALATION",
  "PERMISSION",
];

export function groupApprovals<T extends Pick<ApprovalDto, "kind">>(
  items: readonly T[],
): Array<{ kind: ApprovalKind; items: T[] }> {
  return GROUP_ORDER.map((kind) => ({
    kind,
    items: items.filter((item) => item.kind === kind),
  })).filter((group) => group.items.length > 0);
}
