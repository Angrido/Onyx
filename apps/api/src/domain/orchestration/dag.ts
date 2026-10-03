export const NODE_STATES = [
  "pending",
  "running",
  "verifying",
  "merging",
  "merged",
  "conflict",
  "failed",
  "blocked",
  "cancelled",
] as const;

export type NodeState = (typeof NODE_STATES)[number];

export interface DagNode {
  key: string;
  dependsOn: readonly string[];
  state: NodeState;
}

const ACTIVE: ReadonlySet<NodeState> = new Set(["running", "verifying", "merging"]);
const DEAD: ReadonlySet<NodeState> = new Set(["failed", "blocked", "cancelled"]);

export function parseNodeState(value: string | null | undefined): NodeState {
  return (NODE_STATES as readonly string[]).includes(value ?? "")
    ? (value as NodeState)
    : "pending";
}

export function readyNodes(nodes: readonly DagNode[]): string[] {
  const state = new Map(nodes.map((node) => [node.key, node.state]));
  return nodes
    .filter(
      (node) =>
        node.state === "pending" && node.dependsOn.every((dep) => state.get(dep) === "merged"),
    )
    .map((node) => node.key);
}

export function newlyBlocked(nodes: readonly DagNode[]): string[] {
  const state = new Map(nodes.map((node) => [node.key, node.state]));
  const blocked = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of nodes) {
      if (node.state !== "pending" || blocked.has(node.key)) continue;
      const dead = node.dependsOn.some(
        (dep) => blocked.has(dep) || DEAD.has(state.get(dep) ?? "pending"),
      );
      if (dead) {
        blocked.add(node.key);
        changed = true;
      }
    }
  }
  return [...blocked];
}

export function activeCount(nodes: readonly DagNode[]): number {
  return nodes.filter((node) => ACTIVE.has(node.state)).length;
}

export type DagOutcome = "running" | "waiting" | "merged" | "failed";

export function dagOutcome(nodes: readonly DagNode[]): DagOutcome {
  if (nodes.some((node) => ACTIVE.has(node.state))) return "running";
  if (readyNodes(nodes).length > 0) return "running";
  if (nodes.some((node) => node.state === "conflict")) return "waiting";
  if (nodes.every((node) => node.state === "merged")) return "merged";
  return "failed";
}
