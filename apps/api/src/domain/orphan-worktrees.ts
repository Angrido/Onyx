import type { OrchestrationStatus } from "@onyx/contracts";

export type WorktreeVerdict = "keep" | "remove";

export interface WorktreeOwnerView {
  name: string;
  plan: { status: OrchestrationStatus; workBranch: string | null } | null;
  nodeState: string | null | undefined;
  inUse: boolean;
}

const TEMPORARY_PREFIXES = ["_baseline-", "_resolve-"];
const INTEGRATION = "_integration";

export function worktreeVerdict(owner: WorktreeOwnerView): WorktreeVerdict {
  if (owner.inUse) return "keep";
  const { plan } = owner;
  if (plan === null) return "remove";
  if (plan.status === "COMPLETED" || plan.status === "CANCELLED") return "remove";
  if (plan.status === "FAILED" && plan.workBranch === null) return "remove";
  if (TEMPORARY_PREFIXES.some((prefix) => owner.name.startsWith(prefix))) return "remove";
  if (owner.name === INTEGRATION) return "keep";
  if (owner.nodeState === undefined) return "remove";
  return owner.nodeState === "merged" ? "remove" : "keep";
}
