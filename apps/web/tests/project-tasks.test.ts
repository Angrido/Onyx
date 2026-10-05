import type { TaskDto, TaskStatus } from "@onyx/contracts";
import { describe, expect, it } from "vitest";
import { projectSection } from "@/lib/project-nav";
import {
  filterTasks,
  firstItems,
  projectStatusFacts,
  taskBucket,
  taskFilterCounts,
} from "@/lib/project-tasks";

const NOW = new Date("2026-10-05T12:00:00.000Z").getTime();

function task(id: string, status: TaskStatus, title = id, updatedAt = "2026-10-05T10:00:00.000Z") {
  return {
    id,
    projectId: "p",
    workspaceId: null,
    parentTaskId: null,
    title,
    prompt: title,
    kind: "FEATURE",
    status,
    priority: 0,
    modelOverride: null,
    targetPaths: [],
    branchName: null,
    canWait: false,
    createdAt: updatedAt,
    updatedAt,
    startedAt: null,
    completedAt: null,
    lastRun: null,
    issue: null,
  } as TaskDto;
}

const TASKS = [
  task("a", "RUNNING", "Add the cart total"),
  task("b", "QUEUED", "Fix login"),
  task("c", "AWAITING_APPROVAL", "Plan the cart"),
  task("d", "INTERRUPTED", "Rename users"),
  task("e", "FAILED", "Cart tests", "2026-10-04T10:00:00.000Z"),
  task("f", "FAILED", "Old failure", "2026-09-01T10:00:00.000Z"),
  task("g", "COMPLETED", "Docs"),
  task("h", "CANCELLED", "Dropped"),
];

describe("project tasks", () => {
  it("puts every status in one bucket", () => {
    expect(taskBucket("TDD_LOOP")).toBe("active");
    expect(taskBucket("DRAFT")).toBe("review");
    expect(taskBucket("CANCELLED")).toBe("done");
    expect(taskFilterCounts(TASKS)).toEqual({ all: 8, active: 2, review: 2, failed: 2, done: 2 });
  });

  it("filters by bucket and by title", () => {
    expect(filterTasks(TASKS, "active", "").map((entry) => entry.id)).toEqual(["a", "b"]);
    expect(filterTasks(TASKS, "all", " CART ").map((entry) => entry.id)).toEqual(["a", "c", "e"]);
    expect(filterTasks(TASKS, "failed", "cart").map((entry) => entry.id)).toEqual(["e"]);
    expect(filterTasks(TASKS, "done", "nothing")).toEqual([]);
  });

  it("sums up what runs and what needs you, with recent failures only", () => {
    const facts = projectStatusFacts(TASKS, NOW);
    expect(facts.active.map((entry) => entry.id)).toEqual(["a", "b"]);
    expect(facts.review.map((entry) => entry.id)).toEqual(["c", "d"]);
    expect(facts.recentFailures.map((entry) => entry.id)).toEqual(["e"]);
  });

  it("shows the first items and counts the rest", () => {
    expect(firstItems([1, 2, 3], 2)).toEqual({ visible: [1, 2], hidden: 1 });
    expect(firstItems([1, 2], 8)).toEqual({ visible: [1, 2], hidden: 0 });
    expect(firstItems([1], -1)).toEqual({ visible: [], hidden: 1 });
  });
});

describe("project sections", () => {
  it("finds the tab of the current page", () => {
    expect(projectSection("p1", "/projects/p1")).toEqual({
      tab: "overview",
      exact: true,
      child: null,
    });
    expect(projectSection("p1", "/projects/p1/graph/")).toEqual({
      tab: "graph",
      exact: true,
      child: null,
    });
    expect(projectSection("p1", "/projects/p1/workspaces/w1")).toEqual({
      tab: "overview",
      exact: false,
      child: "workspace",
    });
    expect(projectSection("p1", "/projects/p1/plans/x").child).toBe("plan");
    expect(projectSection("p1", "/projects/p1/unknown").exact).toBe(false);
  });
});
