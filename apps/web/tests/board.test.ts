import type { TaskDto } from "@onyx/contracts";
import { describe, expect, it } from "vitest";
import { columnOfTask, groupTasks, moveFor, priorityOfWeight } from "@/lib/board";

function task(id: string, status: TaskDto["status"], priority = 0): TaskDto {
  return {
    id,
    projectId: "p",
    workspaceId: "w",
    parentTaskId: null,
    title: id,
    prompt: id,
    kind: "FEATURE",
    status,
    priority,
    modelOverride: null,
    targetPaths: [],
    branchName: null,
    canWait: false,
    createdAt: `2026-10-0${id.length}T00:00:00Z`,
    updatedAt: "2026-10-01T00:00:00Z",
    startedAt: null,
    completedAt: status === "COMPLETED" ? "2026-10-02T00:00:00Z" : null,
    lastRun: null,
  };
}

describe("kanban board", () => {
  it("maps task states to columns", () => {
    expect(columnOfTask("DRAFT")).toBe("todo");
    expect(columnOfTask("FAILED")).toBe("todo");
    expect(columnOfTask("QUEUED")).toBe("inProgress");
    expect(columnOfTask("RUNNING")).toBe("inProgress");
    expect(columnOfTask("COMPLETED")).toBe("done");
  });

  it("allows only the moves the API supports", () => {
    expect(moveFor({ kind: "suggestion", id: "s" }, "todo")).toBe("accept");
    expect(moveFor({ kind: "suggestion", id: "s" }, "inProgress")).toBeNull();
    expect(moveFor({ kind: "task", id: "t", from: "todo" }, "inProgress")).toBe("run");
    expect(moveFor({ kind: "task", id: "t", from: "inProgress" }, "todo")).toBe("cancel");
    expect(moveFor({ kind: "task", id: "t", from: "done" }, "todo")).toBeNull();
  });

  it("groups and orders tasks by priority", () => {
    const grouped = groupTasks([
      task("a", "DRAFT", 0),
      task("bb", "DRAFT", 10),
      task("c", "RUNNING"),
    ]);
    expect(grouped.todo.map((entry) => entry.id)).toEqual(["bb", "a"]);
    expect(grouped.inProgress.map((entry) => entry.id)).toEqual(["c"]);
    expect(priorityOfWeight(10)).toBe("HIGH");
    expect(priorityOfWeight(-10)).toBe("LOW");
  });
});
