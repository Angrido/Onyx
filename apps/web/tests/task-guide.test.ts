import { describe, expect, it } from "vitest";
import { translator } from "@/lib/i18n/core";
import {
  activityText,
  renderGuide,
  runBanner,
  taskBanner,
  taskTitle,
  titleFromPrompt,
  type TaskBannerInput,
} from "@/lib/task-guide";

const it_ = translator("it");

const RUN = {
  status: "COMPLETED" as const,
  errorMessage: null,
  changedFiles: ["src/cart.ts", "src/cart.test.ts"],
  costUsd: 0.42,
  durationMs: 65_000,
};

function input(overrides: Partial<TaskBannerInput>): TaskBannerInput {
  return {
    status: "DRAFT",
    run: null,
    blockedCommands: 0,
    waiting: null,
    queuePosition: null,
    quotaHeld: false,
    resetLabel: null,
    activity: null,
    loop: null,
    hasPullRequest: false,
    branchName: null,
    ...overrides,
  };
}

describe("task banner", () => {
  it("offers to start a draft", () => {
    const banner = taskBanner(input({ status: "DRAFT" }));
    expect(banner.actions).toEqual(["start"]);
    expect(renderGuide(banner.title, it_)).toBe("Pronto, non ancora avviato");
  });

  it("explains why a queued task waits", () => {
    expect(
      taskBanner(input({ status: "QUEUED", waiting: "SLOTS", queuePosition: 2 })),
    ).toMatchObject({
      tone: "info",
      busy: true,
      title: { key: "In line: every agent slot is busy" },
      hint: { key: "Position {position} in the queue.", params: { position: 2 } },
      actions: ["stop"],
    });
    expect(taskBanner(input({ status: "QUEUED", waiting: "QUOTA" })).actions).toEqual([
      "approvals",
      "limits",
      "stop",
    ]);
    const held = taskBanner(input({ status: "QUEUED", quotaHeld: true, resetLabel: "alle 14:00" }));
    expect(renderGuide(held.detail ?? held.title, it_)).toBe(
      "I limiti di Claude sono quasi esauriti: parte da solo quando si azzerano alle 14:00.",
    );
  });

  it("says what a running agent is doing", () => {
    const banner = taskBanner(input({ status: "RUNNING", activity: "Edit" }));
    expect(banner.actions).toEqual(["stop"]);
    expect(banner.detail?.key).toBe("Right now it is changing files.");
    expect(activityText("mcp__onyx__outline").key).toBe(
      "Right now it is reading the project index.",
    );
    expect(renderGuide(activityText("Mystery"), it_)).toBe("In questo momento sta usando Mystery.");
  });

  it("translates the TDD phase inside the detail", () => {
    const banner = taskBanner(
      input({
        status: "TDD_LOOP",
        loop: { phase: "tests", iterationCount: 2, maxIterations: 6 },
      }),
    );
    expect(renderGuide(banner.detail ?? banner.title, it_)).toBe(
      "Esecuzione dei test · tentativo 2 di 6.",
    );
  });

  it("points a completed task to the next step", () => {
    expect(taskBanner(input({ status: "COMPLETED", run: RUN })).actions).toEqual([
      "publish",
      "followUp",
    ]);
    expect(
      taskBanner(input({ status: "COMPLETED", run: RUN, branchName: "onyx/cart" })).actions,
    ).toEqual(["openPullRequest", "followUp"]);
    expect(
      taskBanner(input({ status: "COMPLETED", run: RUN, hasPullRequest: true })).actions,
    ).toEqual(["viewPullRequest", "followUp"]);
    const empty = taskBanner(input({ status: "COMPLETED", run: { ...RUN, changedFiles: [] } }));
    expect(empty.actions).toEqual(["followUp"]);
    expect(renderGuide(taskBanner(input({ status: "COMPLETED", run: RUN })).detail!, it_)).toBe(
      "2 file modificati · $0.420 · 1m 5s.",
    );
  });

  it("carries the error of a failed run and offers a retry", () => {
    const banner = taskBanner(
      input({
        status: "FAILED",
        run: { ...RUN, status: "FAILED", errorMessage: "Every agent slot is busy" },
      }),
    );
    expect(banner).toMatchObject({ tone: "danger", error: "Every agent slot is busy" });
    expect(banner.actions).toEqual(["retry"]);
    expect(
      taskBanner(input({ status: "FAILED", run: { ...RUN, status: "TIMEOUT" } })).title.key,
    ).toBe("It ran out of time");
  });

  it("asks to relaunch an interrupted task and to allow refused commands", () => {
    expect(taskBanner(input({ status: "INTERRUPTED" })).actions).toEqual(["relaunch"]);
    expect(taskBanner(input({ status: "CANCELLED" })).actions).toEqual(["rerun"]);
    expect(
      taskBanner(input({ status: "COMPLETED", run: RUN, blockedCommands: 2 })).actions,
    ).toEqual(["allow"]);
    expect(taskBanner(input({ status: "RUNNING", blockedCommands: 2 })).actions).toEqual(["stop"]);
  });
});

describe("run banner", () => {
  it("follows the run status", () => {
    expect(
      runBanner({ status: "RUNNING", run: RUN, blockedCommands: 0, activity: null }).actions,
    ).toEqual(["abort"]);
    expect(
      runBanner({ status: "COMPLETED", run: RUN, blockedCommands: 0, activity: null }),
    ).toMatchObject({
      tone: "success",
      actions: ["task"],
    });
    expect(
      runBanner({ status: "COMPLETED", run: RUN, blockedCommands: 1, activity: null }).actions,
    ).toEqual(["allow", "task"]);
    expect(
      runBanner({
        status: "FAILED",
        run: { ...RUN, errorMessage: "Claude could not start" },
        blockedCommands: 0,
        activity: null,
      }).error,
    ).toBe("Claude could not start");
  });
});

describe("title from the prompt", () => {
  it("uses the first meaningful line", () => {
    expect(titleFromPrompt("\n\n## Add a cart total\nShow it under the list")).toBe(
      "Add a cart total",
    );
    expect(titleFromPrompt("- fix   the   login\n")).toBe("fix the login");
    expect(titleFromPrompt("   ")).toBe("");
  });

  it("shortens long lines on a word", () => {
    const title = titleFromPrompt(`${"word ".repeat(40)}end`, 30);
    expect(title.length).toBeLessThanOrEqual(30);
    expect(title.endsWith("…")).toBe(true);
    expect(title).toBe("word word word word word word…");
  });

  it("prefers the title typed by the operator", () => {
    expect(taskTitle("  My title ", "Prompt line")).toBe("My title");
    expect(taskTitle("", "Prompt line\nmore")).toBe("Prompt line");
  });
});
