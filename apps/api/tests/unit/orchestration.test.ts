import { execFileSync } from "node:child_process";
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { budgetLevel, periodKey, periodStart } from "../../src/domain/budget";
import {
  dagOutcome,
  newlyBlocked,
  readyNodes,
  type DagNode,
} from "../../src/domain/orchestration/dag";
import {
  buildPlannerPrompt,
  extractPlan,
  nodePrompt,
  PLAN_MARKER,
  PlanError,
  topologicalLevels,
  validatePlan,
} from "../../src/domain/orchestration/plan";
import { GitRepo, linkDependencies } from "../../src/infrastructure/git-worktree";

const WORKSPACES = [
  { name: "Frontend", domain: "FRONTEND", pathGlobs: ["src/app/**"] },
  { name: "Backend", domain: "BACKEND", pathGlobs: ["src/server/**"] },
];

describe("plan validation", () => {
  it("normalises keys, workspaces, kinds and dependencies", () => {
    const plan = validatePlan(
      {
        summary: "Add totals",
        tasks: [
          {
            key: "API Endpoint",
            title: "Add the totals endpoint",
            description: "Expose totals",
            workspace: "backend",
            kind: "feature",
            tier: "apex",
            dependsOn: [],
            targetPaths: ["./src/server/totals.ts", "src/server/totals.ts"],
            acceptance: ["totals.test.ts passes"],
          },
          {
            title: "Show totals in the cart",
            description: "Render the totals",
            workspace: "Frontend",
            dependsOn: ["api endpoint", "ghost"],
          },
          {
            title: "Write docs",
            description: "Document it",
            dependsOn: ["show-totals-in-the-cart"],
          },
        ],
      },
      WORKSPACES,
    );
    expect(plan.nodes.map((node) => node.key)).toEqual([
      "api-endpoint",
      "show-totals-in-the-cart",
      "write-docs",
    ]);
    expect(plan.nodes[0]).toMatchObject({
      workspace: "Backend",
      kind: "FEATURE",
      tier: "ARCHITECT",
      targetPaths: ["src/server/totals.ts"],
    });
    expect(plan.nodes[1]?.dependsOn).toEqual(["api-endpoint"]);
    expect(plan.levels).toEqual({
      "api-endpoint": 0,
      "show-totals-in-the-cart": 1,
      "write-docs": 2,
    });
    expect(plan.warnings).toContain(
      'show-totals-in-the-cart: dropped the unknown dependency "ghost"',
    );
  });

  it("rejects cycles and empty plans", () => {
    expect(() =>
      validatePlan(
        {
          summary: "x",
          tasks: [
            { key: "a", title: "Task A", description: "a", dependsOn: ["b"] },
            { key: "b", title: "Task B", description: "b", dependsOn: ["a"] },
          ],
        },
        WORKSPACES,
      ),
    ).toThrow(PlanError);
    expect(() => validatePlan({ summary: "x", tasks: [] }, WORKSPACES)).toThrow(PlanError);
    expect(() => topologicalLevels([{ key: "a", dependsOn: ["a"] }])).toThrow(/cycle/);
  });

  it("reads structured output or JSON in the text", () => {
    expect(extractPlan({ summary: "s", tasks: [] }, null)).toEqual({ summary: "s", tasks: [] });
    expect(
      extractPlan(undefined, 'Here:\n```json\n{"summary":"s","tasks":[{"title":"x"}]}\n```'),
    ).toEqual({ summary: "s", tasks: [{ title: "x" }] });
    expect(extractPlan(undefined, "no plan")).toBeNull();
  });

  it("builds the planner and node prompts", () => {
    const prompt = buildPlannerPrompt({
      projectName: "shop",
      goal: "Add a cart total",
      map: "src/app/cart.ts",
      readme: null,
      workspaces: WORKSPACES,
      testRunner: "Vitest",
      gitLog: [],
    });
    expect(prompt.startsWith(PLAN_MARKER)).toBe(true);
    expect(prompt).toContain("- Backend (BACKEND): src/server/**");
    const node = validatePlan(
      {
        summary: "s",
        tasks: [
          {
            title: "Add totals",
            description: "Implement totals",
            targetPaths: ["src/server/totals.ts"],
            acceptance: ["tests pass"],
          },
        ],
      },
      WORKSPACES,
    ).nodes[0];
    if (!node) throw new Error("node missing");
    const text = nodePrompt({
      goal: "Add a cart total",
      summary: "s",
      node,
      dependencies: [{ title: "Base", summary: "Done" }],
      siblings: [{ title: "Show totals", workspace: "Frontend" }],
    });
    expect(text).toContain("Already merged into your branch:\n- Base: Done");
    expect(text).toContain("## Acceptance criteria\n\n- tests pass");
    expect(text.endsWith("Files likely involved: src/server/totals.ts")).toBe(true);
  });
});

describe("DAG scheduling", () => {
  const nodes = (states: Record<string, DagNode["state"]>): DagNode[] => [
    { key: "a", dependsOn: [], state: states.a ?? "pending" },
    { key: "b", dependsOn: [], state: states.b ?? "pending" },
    { key: "c", dependsOn: ["a", "b"], state: states.c ?? "pending" },
    { key: "d", dependsOn: ["c"], state: states.d ?? "pending" },
  ];

  it("runs independent nodes first and dependents after their merges", () => {
    expect(readyNodes(nodes({}))).toEqual(["a", "b"]);
    expect(readyNodes(nodes({ a: "merged", b: "running" }))).toEqual([]);
    expect(readyNodes(nodes({ a: "merged", b: "merged" }))).toEqual(["c"]);
    expect(dagOutcome(nodes({ a: "merged", b: "merged", c: "merged", d: "merged" }))).toBe(
      "merged",
    );
  });

  it("blocks dependents of failed nodes and waits on conflicts", () => {
    expect(newlyBlocked(nodes({ a: "failed" }))).toEqual(["c", "d"]);
    expect(dagOutcome(nodes({ a: "merged", b: "conflict" }))).toBe("waiting");
    expect(dagOutcome(nodes({ a: "failed", b: "merged", c: "blocked", d: "blocked" }))).toBe(
      "failed",
    );
  });
});

describe("budget periods", () => {
  const now = new Date("2026-10-03T15:30:00Z");
  it("keys and starts periods in UTC", () => {
    expect(periodKey("DAY", now)).toBe("2026-10-03");
    expect(periodKey("MONTH", now)).toBe("2026-10");
    expect(periodKey("LIFETIME", now)).toBe("lifetime");
    expect(periodStart("MONTH", now)?.toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(periodStart("LIFETIME", now)).toBeNull();
  });

  it("classifies spend against soft and hard limits", () => {
    expect(budgetLevel({ softUsd: 5, hardUsd: 10 }, 4.99)).toBe("ok");
    expect(budgetLevel({ softUsd: 5, hardUsd: 10 }, 5)).toBe("soft");
    expect(budgetLevel({ softUsd: null, hardUsd: 10 }, 10)).toBe("hard");
  });
});

describe("git worktrees", () => {
  const root = mkdtempSync(join(tmpdir(), "onyx-worktree-"));
  const env = {
    GIT_AUTHOR_NAME: "Onyx",
    GIT_AUTHOR_EMAIL: "onyx@example.com",
    GIT_COMMITTER_NAME: "Onyx",
    GIT_COMMITTER_EMAIL: "onyx@example.com",
  };
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it("branches, commits in worktrees, merges and reports conflicts", async () => {
    const repo = join(root, "repo");
    execFileSync("git", ["init", "-q", "-b", "main", repo]);
    writeFileSync(join(repo, "a.txt"), "one\n");
    execFileSync("git", ["add", "."], { cwd: repo });
    execFileSync("git", ["commit", "-q", "-m", "init"], {
      cwd: repo,
      env: { ...process.env, ...env },
    });
    const git = new GitRepo(repo);
    expect(await git.isRepo()).toBe(true);
    const base = await git.head();
    expect(base.branch).toBe("main");
    await git.createBranch("onyx/work", base.commit);
    const integration = join(repo, ".onyx", "worktrees", "_integration");
    await git.addWorktree(integration, "onyx/work", base.commit);
    const left = join(repo, ".onyx", "worktrees", "left");
    const right = join(repo, ".onyx", "worktrees", "right");
    await git.addWorktree(left, "onyx/left", "onyx/work");
    await git.addWorktree(right, "onyx/right", "onyx/work");
    writeFileSync(join(left, "b.txt"), "left\n");
    writeFileSync(join(right, "a.txt"), "right\n");
    expect(await git.commitAll(left, "left", env)).toMatch(/^[0-9a-f]{40}$/);
    expect(await git.commitAll(right, "right", env)).toMatch(/^[0-9a-f]{40}$/);
    expect(await git.commitAll(right, "nothing", env)).toBeNull();
    const first = await git.merge(integration, "onyx/left", "Merge left", env);
    expect(first).toMatchObject({ ok: true, changed: true });
    const second = await git.merge(integration, "onyx/right", "Merge right", env);
    expect(second.ok).toBe(true);
    expect(readFileSync(join(integration, "a.txt"), "utf8")).toBe("right\n");

    const clash = join(repo, ".onyx", "worktrees", "clash");
    await git.addWorktree(clash, "onyx/clash", base.commit);
    writeFileSync(join(clash, "a.txt"), "clash\n");
    await git.commitAll(clash, "clash", env);
    const conflict = await git.merge(integration, "onyx/clash", "Merge clash", env);
    expect(conflict).toEqual({ ok: false, conflicts: ["a.txt"] });
    expect(readFileSync(join(integration, "a.txt"), "utf8")).toBe("right\n");
    await git.removeWorktree(clash);
    expect(await git.branchExists("onyx/clash")).toBe(true);
    expect((await git.head()).branch).toBe("main");
  });

  it("links dependencies into worktrees without committing them", async () => {
    const repo = join(root, "deps");
    execFileSync("git", ["init", "-q", "-b", "main", repo]);
    mkdirSync(join(repo, "node_modules", "left-pad"), { recursive: true });
    mkdirSync(join(repo, "web", "node_modules"), { recursive: true });
    writeFileSync(join(repo, ".gitignore"), "/node_modules/\nweb/node_modules/\n");
    writeFileSync(join(repo, "web", "index.ts"), "export {};\n");
    execFileSync("git", ["add", "."], { cwd: repo });
    execFileSync("git", ["commit", "-q", "-m", "init"], {
      cwd: repo,
      env: { ...process.env, ...env },
    });
    const git = new GitRepo(repo);
    const tree = join(root, "deps-tree");
    await git.addWorktree(tree, "onyx/deps", "main");
    const linked = await linkDependencies(repo, tree);
    expect(linked.sort()).toEqual(["node_modules", "web/node_modules"]);
    expect(lstatSync(join(tree, "node_modules")).isSymbolicLink()).toBe(true);
    writeFileSync(join(tree, "web", "index.ts"), "export const ready = true;\n");
    expect(await git.commitAll(tree, "change", env, linked)).toMatch(/^[0-9a-f]{40}$/);
    const files = execFileSync("git", ["ls-tree", "-r", "--name-only", "onyx/deps"], { cwd: repo })
      .toString()
      .trim()
      .split("\n");
    expect(files.sort()).toEqual([".gitignore", "web/index.ts"]);
  });
});
