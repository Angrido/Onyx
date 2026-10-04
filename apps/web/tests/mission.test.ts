import type { MissionProjectDto } from "@onyx/contracts";
import { describe, expect, it } from "vitest";
import { filterCounts, filterProjects, gitLine, sortProjects, worstHealth } from "../lib/mission";

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
