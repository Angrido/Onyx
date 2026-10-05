import { describe, expect, it } from "vitest";
import { bracketedPaste, taskContextText } from "../../src/domain/task-context";

describe("task context for a terminal", () => {
  it("lists the task, its criteria and its files", () => {
    expect(
      taskContextText({
        title: " Login form ",
        prompt: "Add a login form.",
        acceptance: ["Shows an error on a wrong password"],
        targetPaths: ["apps/web/login.tsx", "apps/api/auth.ts"],
      }),
    ).toBe(
      [
        "Task: Login form",
        "Add a login form.",
        "Acceptance criteria:\n- Shows an error on a wrong password",
        "Files to start from: apps/web/login.tsx, apps/api/auth.ts",
      ].join("\n\n"),
    );
    expect(taskContextText({ title: "T", prompt: "", acceptance: [], targetPaths: [] })).toBe(
      "Task: T",
    );
    const long = taskContextText({
      title: "T",
      prompt: "x".repeat(9_000),
      acceptance: [],
      targetPaths: [],
    });
    expect(long).toHaveLength(8_000);
    expect(long.endsWith("…")).toBe(true);
  });

  it("pastes without submitting and drops control characters", () => {
    expect(bracketedPaste("a\nb\u001b[201~\r\u0003c")).toBe("\u001b[200~a\nb[201~c\u001b[201~");
  });
});
