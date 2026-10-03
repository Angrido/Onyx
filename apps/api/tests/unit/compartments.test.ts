import { describe, expect, it } from "vitest";
import { ZoneMap } from "../../src/domain/compartments";
import { composeHandoff, openItems, type RunDigest } from "../../src/domain/handoff";

const zones = new ZoneMap([
  { id: "fe", name: "Frontend", domain: "FRONTEND", pathGlobs: ["apps/web/**"] },
  { id: "be", name: "Backend", domain: "BACKEND", pathGlobs: ["apps/api/**"] },
  { id: "db", name: "Database", domain: "DATABASE", pathGlobs: ["**/prisma/**"] },
  { id: "empty", name: "Custom", domain: "CUSTOM", pathGlobs: [] },
]);

function digest(overrides: Partial<RunDigest>): RunDigest {
  return {
    workspaceName: "Frontend",
    taskTitle: "Task",
    status: "COMPLETED",
    endedAt: new Date("2026-10-03T10:00:00Z"),
    changedFiles: [],
    summary: null,
    ...overrides,
  };
}

const estimate = (text: string) => Math.ceil(text.length / 4);

describe("ZoneMap", () => {
  it("infers the workspace that owns most target paths", () => {
    expect(zones.infer(["apps/api/src/a.ts", "apps/web/b.tsx", "apps/api/src/c.ts"])).toEqual({
      workspaceId: "be",
      matches: [
        { workspaceId: "be", paths: 2 },
        { workspaceId: "fe", paths: 1 },
      ],
      domains: ["BACKEND", "FRONTEND"],
      unmatched: [],
    });
    expect(zones.infer(["README.md"])).toMatchObject({
      workspaceId: null,
      unmatched: ["README.md"],
    });
    expect(zones.infer(["apps/web/a.tsx", "apps/api/b.ts"]).workspaceId).toBe("fe");
    expect(zones.zoneOf("apps/api/prisma/schema.prisma")?.name).toBe("Backend");
  });
});

describe("handoff notes", () => {
  it("summarises the earlier session and the other workspaces", () => {
    const handoff = composeHandoff({
      workspaceName: "Frontend",
      reason: "DOMAIN_SWITCH",
      own: [
        digest({
          taskTitle: "Add the login button",
          changedFiles: ["apps/web/components/login-button.tsx"],
          summary: "Added the button.\nTODO: wire the button to the API",
        }),
      ],
      foreign: [
        digest({
          workspaceName: "Backend",
          taskTitle: "Expose POST /api/login",
          changedFiles: ["apps/api/src/routes/login.ts"],
          summary: "Route added. Next steps: rate limiting",
          endedAt: new Date("2026-10-03T11:00:00Z"),
        }),
      ],
      budgetTokens: 1_500,
      estimate,
    });
    expect(handoff).toMatchObject({ ownRuns: 1, foreignRuns: 1 });
    expect(handoff?.text).toContain("# Handoff for the Frontend workspace");
    expect(handoff?.text).toContain("after a domain switch");
    expect(handoff?.text).toContain(
      '- "Add the login button" (completed): changed apps/web/components/login-button.tsx',
    );
    expect(handoff?.text).toContain(
      '- Backend · "Expose POST /api/login" (completed): changed apps/api/src/routes/login.ts',
    );
    expect(handoff?.text).toContain("## Open items\n- wire the button to the API\n- rate limiting");
  });

  it("stays within the token budget by dropping the oldest runs", () => {
    const runs = Array.from({ length: 30 }, (_, index) =>
      digest({
        taskTitle: `Task ${index}`,
        summary: "x".repeat(600),
        changedFiles: Array.from(
          { length: 20 },
          (__, file) => `apps/web/file-${index}-${file}.tsx`,
        ),
        endedAt: new Date(Date.UTC(2026, 9, 3, 0, index)),
      }),
    );
    const handoff = composeHandoff({
      workspaceName: "Frontend",
      reason: "CONTEXT_PRESSURE",
      own: runs,
      foreign: [],
      budgetTokens: 1_500,
      estimate,
    });
    expect(handoff?.tokens).toBeLessThanOrEqual(1_500);
    expect(handoff?.text).toContain("Task 29");
    expect(handoff?.text).not.toContain('"Task 0"');
    expect(handoff?.text).toContain("and 8 more");
  });

  it("returns nothing without material and extracts open items", () => {
    expect(
      composeHandoff({
        workspaceName: "X",
        reason: null,
        own: [],
        foreign: [],
        budgetTokens: 100,
        estimate,
      }),
    ).toBeNull();
    expect(openItems(["- [ ] write docs\n* FIXME flaky test\nplain line", null])).toEqual([
      "write docs",
      "flaky test",
    ]);
  });
});
