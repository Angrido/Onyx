import type { QueueDto, QueueItemKind, QueueWaitReason } from "@onyx/contracts";

export const WAIT_LABELS: Record<QueueWaitReason, string> = {
  SLOTS: "waiting for a free slot",
  PROJECT: "project at its run limit",
  WORKSPACE: "workspace busy",
  QUOTA: "held by the quota or a budget",
};

export const KIND_LABELS: Record<QueueItemKind, string | null> = {
  TASK: null,
  TDD: "TDD fix",
  PLAN: "Plan step",
};

export const AGING_OPTIONS = [
  { label: "Off", minutes: 0 },
  { label: "Every 15 minutes", minutes: 15 },
  { label: "Every 30 minutes", minutes: 30 },
  { label: "Every hour", minutes: 60 },
  { label: "Every 2 hours", minutes: 120 },
] as const;

export function limitOptions(maxConcurrent: number): number[] {
  return Array.from({ length: Math.max(1, maxConcurrent) }, (_, index) => index + 1);
}

export function slotSummary(queue: Pick<QueueDto, "active" | "maxConcurrent" | "reservedSlots">) {
  const used = Math.min(queue.maxConcurrent, queue.active.length + queue.reservedSlots);
  const terminals = queue.reservedSlots > 0 ? ` · ${queue.reservedSlots} held by terminals` : "";
  return `${used} of ${queue.maxConcurrent} ${queue.maxConcurrent === 1 ? "slot" : "slots"} in use${terminals}`;
}

export function projectLimitLabel(limit: number | null): string {
  if (limit === null) return "no limit";
  return `at most ${limit} ${limit === 1 ? "run" : "runs"}`;
}
