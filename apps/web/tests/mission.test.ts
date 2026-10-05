import type { MissionProjectDto } from "@onyx/contracts";
import { describe, expect, it } from "vitest";
import { translator } from "@/lib/i18n/core";
import {
  activityLine,
  filterCounts,
  filterProjects,
  gitLine,
  globalIssues,
  isQuiet,
  lastTaskAt,
  sortProjects,
  spendLine,
  worstHealth,
} from "../lib/mission";

const SPEND = { runs: 0, costUsd: 0, tokens: 0, cacheReadTokens: 0 };

function project(name: string, overrides: Partial<MissionProjectDto> = {}): MissionProjectDto {
  return {
    id: name,
    name,
    defaultBranch: "main",
    git: {
      isRepo: true,
      branch: "main",
      upstream: null,
      ahead: 0,
      behind: 0,
      changeCount: 0,
      checkedAt: "2026-10-04T10:00:00.000Z",
      error: null,
    },
    running: 0,
    queued: 0,
    runLimit: null,
    activeTasks: [],
    lastRun: null,
    lastTdd: null,
    today: SPEND,
    week: SPEND,
    pendingApprovals: 0,
    openTasks: 0,
    lastActivityAt: "2026-10-01T10:00:00.000Z",
    health: "OK",
    reasons: [],
    checks: [],
    ...overrides,
  };
}

const PROJECTS = [
  project("web", { running: 1, lastActivityAt: "2026-10-02T10:00:00.000Z" }),
  project("api", { health: "ATTENTION", today: { ...SPEND, costUsd: 2 } }),
  project("docs", { lastActivityAt: "2026-10-03T10:00:00.000Z", week: { ...SPEND, costUsd: 5 } }),
  project("infra", { queued: 2, health: "ERROR" }),
];

describe("mission control filters", () => {
  it("filters by state and name", () => {
    expect(filterProjects(PROJECTS, "working", "").map((entry) => entry.name)).toEqual([
      "web",
      "infra",
    ]);
    expect(filterProjects(PROJECTS, "attention", "").map((entry) => entry.name)).toEqual([
      "api",
      "infra",
    ]);
    expect(filterProjects(PROJECTS, "idle", "D").map((entry) => entry.name)).toEqual(["docs"]);
    expect(filterCounts(PROJECTS)).toEqual({ all: 4, working: 2, attention: 2, idle: 2 });
  });

  it("sorts working projects first, then by activity, name or spend", () => {
    expect(sortProjects(PROJECTS, "activity").map((entry) => entry.name)).toEqual([
      "web",
      "infra",
      "docs",
      "api",
    ]);
    expect(sortProjects(PROJECTS, "name").map((entry) => entry.name)).toEqual([
      "api",
      "docs",
      "infra",
      "web",
    ]);
    expect(sortProjects(PROJECTS, "today")[0]?.name).toBe("api");
    expect(sortProjects(PROJECTS, "week")[0]?.name).toBe("docs");
  });

  it("describes git state and the worst health", () => {
    expect(gitLine(project("a"))).toBe("main · clean");
    const busy = project("b");
    busy.git = { ...busy.git, changeCount: 3, ahead: 1, behind: 2 };
    expect(gitLine(busy)).toBe("main · 3 changed · 1 ahead · 2 behind");
    const none = project("c");
    none.git = { ...none.git, isRepo: false };
    expect(gitLine(none)).toBe("Not a git repository");
    expect(worstHealth(PROJECTS)).toBe("ERROR");
    expect(worstHealth([])).toBe("OK");
  });
});

describe("mission control cards", () => {
  it("keeps idle projects compact until something happens", () => {
    expect(isQuiet(project("idle"))).toBe(true);
    expect(isQuiet(project("week", { week: { ...SPEND, runs: 2, costUsd: 1 } }))).toBe(true);
    expect(isQuiet(project("running", { running: 1 }))).toBe(false);
    expect(isQuiet(project("queued", { queued: 1 }))).toBe(false);
    expect(isQuiet(project("waiting", { pendingApprovals: 1 }))).toBe(false);
    expect(isQuiet(project("today", { today: { ...SPEND, runs: 1, tokens: 10 } }))).toBe(false);
  });

  it("hides empty spend and shortens a week without spend today", () => {
    expect(spendLine(project("none"))).toBeNull();
    expect(spendLine(project("week", { week: { ...SPEND, costUsd: 1.5 } }))).toBe(
      "This week $1.50",
    );
    expect(
      spendLine(
        project("today", {
          today: { ...SPEND, costUsd: 0.5, tokens: 1200 },
          week: { ...SPEND, costUsd: 2 },
        }),
      ),
    ).toBe("Today $0.500 · 1.2K tokens · week $2.00");
    expect(spendLine(project("week", { week: { ...SPEND, costUsd: 1.5 } }), translator("it"))).toBe(
      "Questa settimana $1.50",
    );
  });

  it("says when the last task ran and what is running", () => {
    expect(lastTaskAt(project("none"))).toBeNull();
    const ran = project("ran", {
      lastRun: {
        runId: "r",
        taskId: "t",
        title: "Fix",
        status: "COMPLETED",
        startedAt: "2026-10-03T10:00:00.000Z",
        endedAt: "2026-10-03T10:05:00.000Z",
      },
    });
    expect(lastTaskAt(ran)).toBe("2026-10-03T10:05:00.000Z");
    expect(activityLine(project("busy", { running: 2, queued: 1, openTasks: 3 }))).toBe(
      "2 running · 1 queued · 3 open tasks",
    );
  });

  it("lists only the shared problems, worst first", () => {
    expect(
      globalIssues([
        { id: "claude", level: "OK", reason: "Claude account connected" },
        { id: "disk", level: "ATTENTION", reason: "Space is running low" },
      ]).map((check) => check.id),
    ).toEqual(["disk"]);
    expect(
      globalIssues([
        { id: "claude", level: "ATTENTION", reason: "Claude is not connected" },
        { id: "disk", level: "ERROR", reason: "Almost no space left" },
      ]).map((check) => check.id),
    ).toEqual(["disk", "claude"]);
  });
});
