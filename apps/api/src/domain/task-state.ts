import type { TaskStatus } from "@onyx/contracts";

const TRANSITIONS: Readonly<Record<TaskStatus, readonly TaskStatus[]>> = {
  DRAFT: ["QUEUED", "PLANNING", "CANCELLED"],
  PLANNING: ["AWAITING_APPROVAL", "FAILED", "CANCELLED", "INTERRUPTED"],
  AWAITING_APPROVAL: ["QUEUED", "CANCELLED"],
  QUEUED: ["RUNNING", "CANCELLED", "INTERRUPTED"],
  RUNNING: ["COMPLETED", "FAILED", "CANCELLED", "INTERRUPTED", "TDD_LOOP"],
  TDD_LOOP: ["COMPLETED", "FAILED", "CANCELLED", "INTERRUPTED"],
  COMPLETED: ["QUEUED"],
  FAILED: ["QUEUED"],
  CANCELLED: ["QUEUED"],
  INTERRUPTED: ["QUEUED", "CANCELLED"],
};

export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function isRunnable(status: TaskStatus): boolean {
  return canTransition(status, "QUEUED");
}

export function isActive(status: TaskStatus): boolean {
  return (
    status === "QUEUED" || status === "RUNNING" || status === "TDD_LOOP" || status === "PLANNING"
  );
}
