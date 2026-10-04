import type {
  ApprovalDto,
  ApprovalKind,
  BudgetDto,
  BudgetLevelName,
  NodeStateName,
  OrchestrationDto,
  QaVerdict,
  ResolutionState,
  OrchestrationNode,
  OrchestrationStatus,
} from "@onyx/contracts";
import type { BadgeProps } from "@/components/ui/badge";

type Tone = NonNullable<BadgeProps["tone"]>;

export const PLAN_STATUS_TONES: Record<OrchestrationStatus, Tone> = {
  PLANNING: "architect",
  AWAITING_APPROVAL: "warning",
  RUNNING: "primary",
  VERIFYING: "primary",
  COMPLETED: "success",
  FAILED: "danger",
  CANCELLED: "neutral",
};

export const PLAN_STATUS_LABELS: Record<OrchestrationStatus, string> = {
  PLANNING: "Planning",
  AWAITING_APPROVAL: "Waiting for approval",
  RUNNING: "Running",
  VERIFYING: "Final tests",
  COMPLETED: "Merged",
  FAILED: "Stopped",
  CANCELLED: "Cancelled",
};

export const NODE_STATE_TONES: Record<NodeStateName, Tone> = {
  pending: "neutral",
  running: "primary",
  verifying: "primary",
  reviewing: "primary",
  review: "warning",
  merging: "architect",
  merged: "success",
  conflict: "warning",
  failed: "danger",
  blocked: "neutral",
  cancelled: "neutral",
};

export const NODE_STATE_LABELS: Record<NodeStateName, string> = {
  pending: "Waiting",
  running: "Agent working",
  verifying: "Running tests",
  reviewing: "QA review",
  review: "QA found problems",
  merging: "Merging",
  merged: "Merged",
  conflict: "Merge conflict",
  failed: "Failed",
  blocked: "Blocked",
  cancelled: "Cancelled",
};

export const QA_VERDICT_LABELS: Record<QaVerdict, string> = {
  PASS: "QA passed",
  FAIL: "QA found problems",
  ERROR: "QA did not finish",
};

export const QA_VERDICT_TONES: Record<QaVerdict, Tone> = {
  PASS: "success",
  FAIL: "warning",
  ERROR: "danger",
};

export const RESOLUTION_LABELS: Record<ResolutionState, string> = {
  PROPOSED: "Resolution proposed",
  APPLIED: "Resolution applied",
  DISCARDED: "Resolution refused",
  FAILED: "Resolution not usable",
};

export const RESOLUTION_TONES: Record<ResolutionState, Tone> = {
  PROPOSED: "warning",
  APPLIED: "success",
  DISCARDED: "neutral",
  FAILED: "danger",
};

export const APPROVAL_KIND_LABELS: Record<ApprovalKind, string> = {
  PLAN: "Plan",
  MERGE: "Merge",
  BUDGET: "Budget",
  ESCALATION: "Escalation",
  PERMISSION: "Permission",
  QA: "QA",
};

export const APPROVAL_KIND_TONES: Record<ApprovalKind, Tone> = {
  PLAN: "architect",
  MERGE: "warning",
  BUDGET: "danger",
  ESCALATION: "apex",
  PERMISSION: "primary",
  QA: "warning",
};

export const BUDGET_LEVEL_TONES: Record<BudgetLevelName, Tone> = {
  ok: "success",
  soft: "warning",
  hard: "danger",
};

export function isPlanActive(plan: Pick<OrchestrationDto, "status">): boolean {
  return plan.status === "PLANNING" || plan.status === "RUNNING" || plan.status === "VERIFYING";
}

export function isPlanOpen(plan: Pick<OrchestrationDto, "status">): boolean {
  return isPlanActive(plan) || plan.status === "AWAITING_APPROVAL";
}

export function canResume(plan: Pick<OrchestrationDto, "status" | "workBranch">): boolean {
  return plan.status === "FAILED" && plan.workBranch !== null;
}

export function isNodeBusy(node: Pick<OrchestrationNode, "state">): boolean {
  return (
    node.state === "running" ||
    node.state === "verifying" ||
    node.state === "reviewing" ||
    node.state === "merging"
  );
}

export function planLevels(nodes: readonly OrchestrationNode[]): OrchestrationNode[][] {
  const levels: OrchestrationNode[][] = [];
  for (const node of nodes) {
    const level = Math.max(0, node.level);
    while (levels.length <= level) levels.push([]);
    levels[level]?.push(node);
  }
  return levels.filter((level) => level.length > 0);
}

export function planProgress(nodes: readonly Pick<OrchestrationNode, "state">[]): {
  merged: number;
  total: number;
  ratio: number;
} {
  const total = nodes.length;
  const merged = nodes.filter((node) => node.state === "merged").length;
  return { merged, total, ratio: total === 0 ? 0 : merged / total };
}

export function upsertPlan(
  plans: readonly OrchestrationDto[],
  plan: OrchestrationDto,
): OrchestrationDto[] {
  const others = plans.filter((entry) => entry.id !== plan.id);
  return [plan, ...others].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function sortApprovals(items: readonly ApprovalDto[]): ApprovalDto[] {
  const rank = (approval: ApprovalDto) => (approval.status === "PENDING" ? 0 : 1);
  return [...items].sort((a, b) => rank(a) - rank(b) || b.createdAt.localeCompare(a.createdAt));
}

export function budgetUsage(budget: Pick<BudgetDto, "spentUsd" | "softUsd" | "hardUsd">): {
  ratio: number;
  softRatio: number | null;
} {
  const ratio = budget.hardUsd > 0 ? Math.min(1, budget.spentUsd / budget.hardUsd) : 1;
  const softRatio =
    budget.softUsd !== null && budget.hardUsd > 0 ? budget.softUsd / budget.hardUsd : null;
  return { ratio, softRatio };
}

export function periodLabel(period: BudgetDto["period"]): string {
  if (period === "DAY") return "per day";
  if (period === "MONTH") return "per month";
  return "in total";
}
