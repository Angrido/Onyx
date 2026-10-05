import type { TaskDto, TaskStatus } from "@onyx/contracts";
import { msg } from "@/lib/i18n/core";

export const TASK_FILTERS = ["all", "active", "review", "failed", "done"] as const;
export type TaskFilter = (typeof TASK_FILTERS)[number];
export type TaskBucket = Exclude<TaskFilter, "all">;

export const TASK_FILTER_LABELS: Record<TaskFilter, string> = {
  all: msg("All"),
  active: msg("Ongoing"),
  review: msg("To review"),
  failed: msg("Errors"),
  done: msg("Finished"),
};

export const TASK_PAGE_SIZE = 10;
export const RECENT_TASKS_SHOWN = 8;
export const RECENT_TASKS_FETCHED = 40;
export const RECENT_FAILURE_DAYS = 7;

const BUCKETS: Record<TaskStatus, TaskBucket> = {
  PLANNING: "active",
  QUEUED: "active",
  RUNNING: "active",
  TDD_LOOP: "active",
  DRAFT: "review",
  AWAITING_APPROVAL: "review",
  INTERRUPTED: "review",
  FAILED: "failed",
  COMPLETED: "done",
  CANCELLED: "done",
};

const DAY_MS = 86_400_000;

export function taskBucket(status: TaskStatus): TaskBucket {
  return BUCKETS[status];
}

export function filterTasks(
  tasks: readonly TaskDto[],
  filter: TaskFilter,
  query: string,
): TaskDto[] {
  const needle = query.trim().toLowerCase();
  return tasks.filter((task) => {
    if (needle && !task.title.toLowerCase().includes(needle)) return false;
    return filter === "all" || taskBucket(task.status) === filter;
  });
}

export function taskFilterCounts(tasks: readonly TaskDto[]): Record<TaskFilter, number> {
  const counts: Record<TaskFilter, number> = { all: 0, active: 0, review: 0, failed: 0, done: 0 };
  for (const task of tasks) {
    counts.all += 1;
    counts[taskBucket(task.status)] += 1;
  }
  return counts;
}

export interface ProjectStatusFacts {
  active: TaskDto[];
  review: TaskDto[];
  recentFailures: TaskDto[];
}

export function projectStatusFacts(
  tasks: readonly TaskDto[],
  now: number = Date.now(),
): ProjectStatusFacts {
  const since = now - RECENT_FAILURE_DAYS * DAY_MS;
  return {
    active: tasks.filter((task) => taskBucket(task.status) === "active"),
    review: tasks.filter((task) => taskBucket(task.status) === "review"),
    recentFailures: tasks.filter(
      (task) => task.status === "FAILED" && new Date(task.updatedAt).getTime() >= since,
    ),
  };
}

export function firstItems<T>(
  items: readonly T[],
  shown: number,
): { visible: readonly T[]; hidden: number } {
  const visible = items.slice(0, Math.max(0, shown));
  return { visible, hidden: items.length - visible.length };
}
