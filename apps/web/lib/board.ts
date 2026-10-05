import type { RoadmapPriority, TaskDto, TaskStatus } from "@onyx/contracts";
import { msg } from "@/lib/i18n/core";

export type ColumnId = "suggested" | "todo" | "inProgress" | "done";

export const COLUMNS: Array<{ id: ColumnId; title: string; hint: string }> = [
  { id: "suggested", title: msg("Suggested"), hint: msg("Ideas from the roadmap") },
  { id: "todo", title: msg("To do"), hint: msg("Accepted, waiting to start") },
  { id: "inProgress", title: msg("In progress"), hint: msg("Queued or running") },
  { id: "done", title: msg("Done"), hint: msg("Completed by an agent") },
];

const IN_PROGRESS: ReadonlySet<TaskStatus> = new Set([
  "QUEUED",
  "RUNNING",
  "PLANNING",
  "TDD_LOOP",
  "AWAITING_APPROVAL",
]);

export function columnOfTask(status: TaskStatus): Exclude<ColumnId, "suggested"> {
  if (status === "COMPLETED") return "done";
  return IN_PROGRESS.has(status) ? "inProgress" : "todo";
}

export type DragItem =
  { kind: "suggestion"; id: string } | { kind: "task"; id: string; from: ColumnId };

export type Move = "accept" | "run" | "cancel";

export function moveFor(item: DragItem, to: ColumnId): Move | null {
  if (item.kind === "suggestion") return to === "todo" ? "accept" : null;
  if (item.from === "todo" && to === "inProgress") return "run";
  if (item.from === "inProgress" && to === "todo") return "cancel";
  return null;
}

export function groupTasks(
  tasks: readonly TaskDto[],
): Record<Exclude<ColumnId, "suggested">, TaskDto[]> {
  const grouped: Record<Exclude<ColumnId, "suggested">, TaskDto[]> = {
    todo: [],
    inProgress: [],
    done: [],
  };
  for (const task of tasks) grouped[columnOfTask(task.status)].push(task);
  grouped.todo.sort((a, b) => b.priority - a.priority || a.createdAt.localeCompare(b.createdAt));
  grouped.inProgress.sort(
    (a, b) => b.priority - a.priority || a.createdAt.localeCompare(b.createdAt),
  );
  grouped.done.sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? ""));
  return grouped;
}

export const PRIORITY_STYLES: Record<RoadmapPriority, { label: string; className: string }> = {
  HIGH: {
    label: msg("High"),
    className: "border-destructive/40 bg-destructive/12 text-destructive",
  },
  MEDIUM: { label: msg("Medium"), className: "border-warning/40 bg-warning/12 text-warning" },
  LOW: { label: msg("Low"), className: "border-border-strong bg-surface-2 text-muted-foreground" },
};

export function priorityOfWeight(weight: number): RoadmapPriority {
  if (weight >= 5) return "HIGH";
  if (weight <= -5) return "LOW";
  return "MEDIUM";
}
