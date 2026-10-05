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
import { english, msg, type Translate } from "@/lib/i18n/core";

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
  PLANNING: msg("Planning"),
  AWAITING_APPROVAL: msg("Waiting for approval"),
  RUNNING: msg("Running"),
  VERIFYING: msg("Final tests"),
  COMPLETED: msg("Merged"),
  FAILED: msg("Stopped"),
  CANCELLED: msg("Cancelled"),
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
  pending: msg("Waiting"),
  running: msg("Agent working"),
  verifying: msg("Running tests"),
  reviewing: msg("QA review"),
  review: msg("QA found problems"),
  merging: msg("Merging"),
  merged: msg("Merged"),
  conflict: msg("Merge conflict"),
  failed: msg("Failed"),
  blocked: msg("Blocked"),
  cancelled: msg("Cancelled"),
};

export const QA_VERDICT_LABELS: Record<QaVerdict, string> = {
  PASS: msg("QA passed"),
  FAIL: msg("QA found problems"),
  ERROR: msg("QA did not finish"),
};

export const QA_VERDICT_TONES: Record<QaVerdict, Tone> = {
  PASS: "success",
  FAIL: "warning",
  ERROR: "danger",
};

export const RESOLUTION_LABELS: Record<ResolutionState, string> = {
  PROPOSED: msg("Resolution proposed"),
  APPLIED: msg("Resolution applied"),
  DISCARDED: msg("Resolution refused"),
  FAILED: msg("Resolution not usable"),
};

export const RESOLUTION_TONES: Record<ResolutionState, Tone> = {
  PROPOSED: "warning",
  APPLIED: "success",
  DISCARDED: "neutral",
  FAILED: "danger",
};

export const APPROVAL_KIND_LABELS: Record<ApprovalKind, string> = {
  PLAN: msg("Plan"),
  MERGE: msg("Merge"),
  BUDGET: msg("Budget"),
  ESCALATION: msg("Escalation"),
  PERMISSION: msg("Permission"),
  QA: msg("QA"),
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

export function periodLabel(period: BudgetDto["period"], t: Translate = english): string {
  if (period === "DAY") return t("per day");
  if (period === "MONTH") return t("per month");
  return t("in total");
}
