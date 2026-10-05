import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type {
  ApprovalDto,
  ApprovalListResponse,
  BudgetDto,
  BudgetListResponse,
  OrchestrationDto,
  OrchestrationListResponse,
  ProjectDetailDto,
  PublishPlanResult,
  TaskDto,
  TddLoopDto,
} from "@onyx/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  apiClient,
  authenticate,
  createTestContext,
  destroyTestContext,
  waitFor,
  type ApiClient,
  type TestContext,
} from "../helpers";

const apiDir = join(import.meta.dirname, "..", "..");
const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "Seed",
  GIT_AUTHOR_EMAIL: "seed@example.com",
  GIT_COMMITTER_NAME: "Seed",
  GIT_COMMITTER_EMAIL: "seed@example.com",
};

const TSCONFIG = JSON.stringify({
  compilerOptions: {
    strict: true,
    noEmit: true,
    module: "esnext",
    moduleResolution: "bundler",
    target: "es2022",
    types: [],
    skipLibCheck: true,
  },
  include: ["src/**/*.ts"],
  exclude: ["src/**/*.test.ts"],
});

const PRICE = "export function price(cents: number): number {\n  return cents / 100;\n}\n";
const PRICE_TEST = [
  'import { expect, it } from "vitest";',
  'import { price } from "./price";',
  "",
  'it("converts cents", () => {',
  "  expect(price(250)).toBe(2.5);",
  "});",
  "",
].join("\n");

const TOTALS = [
  "export function total(prices: number[]): number {",
  "  return prices.reduce((sum, value) => sum + value, 0);",
  "}",
  "",
].join("\n");
const TOTALS_TEST = [
  'import { expect, it } from "vitest";',
  'import { total } from "./totals";',
  "",
  'it("sums the prices", () => {',
  "  expect(total([1, 2.5])).toBe(3.5);",
  "});",
  "",
].join("\n");
const BADGE =
  "export function badge(amount: number): string {\n  return `EUR ${amount.toFixed(2)}`;\n}\n";
const BADGE_TEST = [
  'import { expect, it } from "vitest";',
  'import { badge } from "./badge";',
  "",
  'it("formats the amount", () => {',
  '  expect(badge(3.5)).toBe("EUR 3.50");',
  "});",
  "",
].join("\n");
const CART = [
  'import { total } from "../server/totals";',
  'import { badge } from "./badge";',
  "",
  "export function cartLabel(prices: number[]): string {",
  "  return badge(total(prices));",
  "}",
  "",
].join("\n");
const CART_TEST = [
  'import { expect, it } from "vitest";',
  'import { cartLabel } from "./cart";',
  "",
  'it("labels the cart", () => {',
  '  expect(cartLabel([1, 2.5])).toBe("EUR 3.50");',
  "});",
  "",
].join("\n");

const CART_PLAN = {
  summary: "Compute the cart total on the server, format it in the UI, then connect the two.",
  tasks: [
    {
      key: "server-total",
      title: "Server cart total",
      description: "Add total(prices) in src/server/totals.ts with a unit test.",
      workspace: "Backend",
      kind: "FEATURE",
      tier: "BUILDER",
      dependsOn: [],
      targetPaths: ["src/server/totals.ts"],
      acceptance: ["src/server/totals.test.ts passes"],
    },
    {
      key: "ui-badge",
      title: "Price badge",
      description: "Add badge(amount) in src/app/badge.ts with a unit test.",
      workspace: "Frontend",
      kind: "UI_STYLE",
      tier: "SCOUT",
      dependsOn: [],
      targetPaths: ["src/app/badge.ts"],
      acceptance: ["src/app/badge.test.ts passes"],
    },
    {
      key: "cart-label",
      title: "Cart label",
      description: "Add cartLabel(prices) in src/app/cart.ts using total and badge.",
      workspace: "Frontend",
      kind: "FEATURE",
      tier: "BUILDER",
      dependsOn: ["server-total", "ui-badge"],
      targetPaths: ["src/app/cart.ts"],
      acceptance: ["src/app/cart.test.ts passes"],
    },
  ],
};

const CART_EDITS = {
  "Add total(prices)": {
    delayMs: 700,
    edits: [
      { tool: "Write", file: "src/server/totals.ts", content: TOTALS },
      { tool: "Write", file: "src/server/totals.test.ts", content: TOTALS_TEST },
    ],
  },
  "Add badge(amount)": {
    delayMs: 700,
    edits: [
      { tool: "Write", file: "src/app/badge.ts", content: BADGE },
      { tool: "Write", file: "src/app/badge.test.ts", content: BADGE_TEST },
    ],
  },
  "Add cartLabel(prices)": {
    edits: [
      { tool: "Write", file: "src/app/cart.ts", content: CART },
      { tool: "Write", file: "src/app/cart.test.ts", content: CART_TEST },
    ],
  },
};

let fixtures: string;
let planPath: string;
let editsPath: string;
let context: TestContext;
let api: ApiClient;
let sessionCookie: string;

function git(args: string[], cwd: string): string {
  return execFileSync("git", args, { cwd, env: GIT_ENV }).toString().trim();
}

function linkPackage(root: string, name: string, bin: string, binTarget: string): void {
  const source = realpathSync(join(apiDir, "node_modules", name));
  mkdirSync(join(root, "node_modules", ".bin"), { recursive: true });
  symlinkSync(source, join(root, "node_modules", name));
  symlinkSync(join("..", name, binTarget), join(root, "node_modules", ".bin", bin));
}

function createRepo(name: string, files: Record<string, string>, tooling: boolean): string {
  const root = join(context.projectsDir, name);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  writeFileSync(join(root, ".gitignore"), "node_modules\n");
  if (tooling) {
    linkPackage(root, "vitest", "vitest", "vitest.mjs");
    linkPackage(root, "typescript", "tsc", "bin/tsc");
  }
  git(["init", "-q", "-b", "main"], root);
  git(["add", "."], root);
  git(["commit", "-q", "-m", "initial"], root);
  return root;
}

async function registerProject(name: string): Promise<ProjectDetailDto> {
  const response = await api.post<ProjectDetailDto>("/api/projects", {
    name,
    rootPath: join(context.projectsDir, name),
  });
  expect(response.status).toBe(201);
  return response.body;
}

async function waitForPlan(
  id: string,
  accept: (plan: OrchestrationDto) => boolean,
  timeoutMs = 120_000,
): Promise<OrchestrationDto> {
  return waitFor(
    async () => (await api.get<OrchestrationDto>(`/api/orchestrations/${id}`)).body,
    accept,
    timeoutMs,
  );
}

async function plan(
  project: ProjectDetailDto,
  goal: string,
  body: object,
  edits: unknown,
  options: { verify?: boolean } = {},
): Promise<OrchestrationDto> {
  writeFileSync(planPath, JSON.stringify(body));
  writeFileSync(editsPath, JSON.stringify(edits));
  const created = await api.post<OrchestrationDto>(`/api/projects/${project.id}/orchestrations`, {
    goal,
    parallelism: 2,
    verify: options.verify ?? true,
  });
  expect(created.status).toBe(201);
  expect(created.body.status).toBe("PLANNING");
  return waitForPlan(created.body.id, (entry) => entry.status !== "PLANNING", 30_000);
}

async function pendingApprovals(): Promise<ApprovalDto[]> {
  return (await api.get<ApprovalListResponse>("/api/approvals?status=PENDING")).body.items;
}

beforeAll(async () => {
  fixtures = mkdtempSync(join(tmpdir(), "onyx-orchestrator-"));
  planPath = join(fixtures, "plan.json");
  editsPath = join(fixtures, "edits.json");
  writeFileSync(planPath, "{}");
  writeFileSync(editsPath, "{}");
  context = await createTestContext({
    maxConcurrent: 3,
    sourceEnv: { CLAUDE_STUB_PLAN: planPath, CLAUDE_STUB_EDITS: editsPath },
  });
  await context.app.listen({ host: "127.0.0.1", port: 0 });
  const address = context.app.server.address();
  if (address === null || typeof address === "string") throw new Error("API is not listening");
  context.container.config.internalApiUrl = `http://127.0.0.1:${address.port}`;
  sessionCookie = await authenticate(context.app);
  api = apiClient(context.app, sessionCookie);
}, 60_000);

afterAll(async () => {
  await destroyTestContext(context);
  rmSync(fixtures, { recursive: true, force: true });
});

describe("multi-agent orchestrator", () => {
  it("plans, waits for approval, runs in parallel worktrees and merges with green tests", async () => {
    const root = createRepo(
      "shop",
      {
        "package.json": JSON.stringify({
          name: "shop",
          type: "module",
          private: true,
          devDependencies: { vitest: "*" },
        }),
        "tsconfig.json": TSCONFIG,
        "src/server/price.ts": PRICE,
        "src/server/price.test.ts": PRICE_TEST,
      },
      true,
    );
    const baseCommit = git(["rev-parse", "HEAD"], root);
    const project = await registerProject("shop");
    const planned = await plan(
      project,
      "Show the cart total, formatted, next to the cart",
      CART_PLAN,
      CART_EDITS,
    );
    expect(planned.status).toBe("AWAITING_APPROVAL");
    expect(planned.summary).toBe(CART_PLAN.summary);
    expect(planned.plannerCostUsd).toBeCloseTo(0.0031);
    const stored = await context.container.prisma.orchestration.findUnique({
      where: { id: planned.id },
    });
    expect(stored).toMatchObject({ plannerExplorer: true, plannerModelCostUsd: 0.0025 });
    const logs = await context.container.prisma.tokenLog.findMany({
      where: { purpose: "planner" },
    });
    expect(logs.map((log) => log.modelId).sort()).toEqual([
      "claude-haiku-4-5",
      planned.plannerModelId,
    ]);
    expect(planned.approvalId).not.toBeNull();
    expect(
      planned.nodes.map((node) => [node.key, node.level, node.workspaceName, node.state]),
    ).toEqual([
      ["server-total", 0, "Backend", "pending"],
      ["ui-badge", 0, "Frontend", "pending"],
      ["cart-label", 1, "Frontend", "pending"],
    ]);
    expect(planned.nodes[2]?.dependsOn.sort()).toEqual(["server-total", "ui-badge"]);
    expect(planned.nodes.every((node) => node.taskStatus === "AWAITING_APPROVAL")).toBe(true);

    const approvals = await pendingApprovals();
    const approval = approvals.find((entry) => entry.id === planned.approvalId);
    expect(approval).toMatchObject({
      kind: "PLAN",
      orchestrationId: planned.id,
      approveLabel: "Approve and run",
      link: `/projects/${project.id}/plans/${planned.id}`,
    });
    expect(approval?.title).toMatch(/^Plan for shop: /);
    expect(approval?.detail).toMatch(/^3 tasks: /);
    const italian = apiClient(context.app, `${sessionCookie}; onyx_locale=it`);
    const shown = (await italian.get<ApprovalDto>(`/api/approvals/${planned.approvalId}`)).body;
    expect(shown.title).toBe(approval?.title.replace(/^Plan for shop: /, "Piano per shop: "));
    expect(shown.detail).toBe(approval?.detail?.replace(/^3 tasks: /, "3 task: "));
    await apiClient(context.app, `${sessionCookie}; onyx_locale=en`).get("/api/approvals");
    const listed = await api.get<OrchestrationListResponse>(
      `/api/projects/${project.id}/orchestrations`,
    );
    expect(listed.body.items.map((entry) => entry.id)).toContain(planned.id);
    expect(git(["branch", "--list", "onyx/*"], root)).toBe("");

    const decided = await api.post<ApprovalDto>(`/api/approvals/${planned.approvalId}/approve`, {
      note: "go",
    });
    expect(decided.status).toBe(200);
    expect(decided.body.status).toBe("APPROVED");

    const running = await waitForPlan(planned.id, (entry) => entry.status !== "AWAITING_APPROVAL");
    expect(running.workBranch).toMatch(/^onyx\/plan-\d{8}-show-the-cart-total/);
    expect(running.baseBranch).toBe("main");
    expect(running.baseCommit).toBe(baseCommit);

    const finished = await waitForPlan(
      planned.id,
      (entry) => !["RUNNING", "VERIFYING"].includes(entry.status),
      180_000,
    );
    expect(finished.message).toBe(`Merged 3 tasks into ${running.workBranch}`);
    const italianPlan = await apiClient(
      context.app,
      `${sessionCookie}; onyx_locale=it`,
    ).get<OrchestrationDto>(`/api/orchestrations/${planned.id}`);
    expect(italianPlan.body.message).toBe(`Uniti 3 task in ${running.workBranch}`);
    await apiClient(context.app, `${sessionCookie}; onyx_locale=en`).get("/api/approvals");
    expect(finished.status).toBe("COMPLETED");
    expect(finished.nodes.every((node) => node.state === "merged")).toBe(true);
    expect(finished.nodes.every((node) => node.taskStatus === "COMPLETED")).toBe(true);
    expect(finished.nodes.every((node) => node.mergeCommit !== null)).toBe(true);
    expect(finished.verifyLoopId).not.toBeNull();
    const verification = await api.get<TddLoopDto>(`/api/tdd-loops/${finished.verifyLoopId}`);
    expect(verification.body.status).toBe("GREEN");
    const full = verification.body.iterations.filter((iteration) => iteration.scope === "full");
    expect(full.at(-1)).toMatchObject({ passed: 4, failed: 0 });

    const tasks = await context.container.prisma.task.findMany({
      where: { parentTaskId: finished.rootTaskId },
      include: { runs: true },
    });
    const byKey = new Map(tasks.map((task) => [task.planKey, task]));
    const left = byKey.get("server-total")?.runs[0];
    const right = byKey.get("ui-badge")?.runs[0];
    const last = byKey.get("cart-label")?.runs[0];
    if (!left?.endedAt || !right?.endedAt || !last) throw new Error("runs missing");
    expect(left.startedAt.getTime()).toBeLessThan(right.endedAt.getTime());
    expect(right.startedAt.getTime()).toBeLessThan(left.endedAt.getTime());
    expect(last.startedAt.getTime()).toBeGreaterThan(
      Math.max(left.endedAt.getTime(), right.endedAt.getTime()),
    );
    const sessions = await context.container.prisma.session.findMany({
      where: { id: { in: tasks.flatMap((task) => task.runs.map((run) => run.sessionId ?? "")) } },
    });
    expect(new Set(sessions.map((session) => session.id)).size).toBe(3);
    expect(tasks.every((task) => task.worktreePath?.includes(join("worktrees", project.id)))).toBe(
      true,
    );

    const workBranch = running.workBranch ?? "";
    expect(git(["rev-parse", "main"], root)).toBe(baseCommit);
    expect(git(["status", "--porcelain"], root)).toBe("");
    const files = git(["ls-tree", "-r", "--name-only", workBranch], root).split("\n");
    expect(files).toEqual(
      expect.arrayContaining([
        "src/server/totals.ts",
        "src/server/totals.test.ts",
        "src/app/badge.ts",
        "src/app/cart.ts",
        "src/app/cart.test.ts",
      ]),
    );
    expect(files.some((file) => file.startsWith("node_modules"))).toBe(false);
    const merges = git(["log", "--merges", "--format=%s", workBranch], root).split("\n");
    expect(merges).toHaveLength(3);
    expect(merges).toContain('Merge "Cart label" (Onyx plan)');
    expect(git(["worktree", "list", "--porcelain"], root).match(/^worktree /gm)).toHaveLength(1);
    expect(git(["branch", "--list", "onyx/*", "--format=%(refname:short)"], root)).toBe(workBranch);
    const worktrees = join(context.dataDir, "worktrees", project.id, planned.id);
    expect(existsSync(worktrees) ? readdirSync(worktrees) : []).toEqual([]);
    const root_ = await api.get<TaskDto>(`/api/tasks/${finished.rootTaskId}`);
    expect(root_.body.status).toBe("COMPLETED");

    const refused = await api.post(`/api/orchestrations/${planned.id}/publish`);
    expect(refused.status).toBe(400);
    const remote = join(fixtures, "shop-remote.git");
    execFileSync("git", ["init", "-q", "--bare", remote]);
    git(["remote", "add", "origin", remote], root);
    const published = await api.post<PublishPlanResult>(
      `/api/orchestrations/${planned.id}/publish`,
    );
    expect(published.body).toEqual({
      branch: workBranch,
      pushed: true,
      pushError: null,
      compareUrl: null,
    });
    expect(git(["rev-parse", workBranch], remote)).toBe(git(["rev-parse", workBranch], root));
    expect(git(["rev-parse", "--abbrev-ref", "HEAD"], root)).toBe("main");

    const budget = await api.post<BudgetDto>("/api/budgets", {
      scope: "PROJECT",
      projectId: project.id,
      period: "LIFETIME",
      softUsd: null,
      hardUsd: 100,
    });
    expect(budget.body.spentUsd).toBeCloseTo(finished.costUsd, 4);
    await api.delete(`/api/budgets/${budget.body.id}`);
  }, 240_000);

  it("ignores tests that were already red before the plan but not a node's own tests", async () => {
    const legacyTest = [
      'import { expect, it } from "vitest";',
      'import { legacy } from "./legacy";',
      "",
      'it("is still broken", () => {',
      "  expect(legacy()).toBe(2);",
      "});",
      "",
    ].join("\n");
    createRepo(
      "red-shop",
      {
        "package.json": JSON.stringify({
          name: "red-shop",
          type: "module",
          private: true,
          devDependencies: { vitest: "*" },
        }),
        "tsconfig.json": TSCONFIG,
        "src/server/legacy.ts": "export function legacy(): number {\n  return 1;\n}\n",
        "src/server/legacy.test.ts": legacyTest,
        "src/server/price.ts":
          "export function price(cents: number): number {\n  return cents;\n}\n",
        "src/server/price.test.ts": PRICE_TEST,
      },
      true,
    );
    const project = await registerProject("red-shop");
    const body = {
      summary: "Fix the price conversion and add a badge.",
      tasks: [
        {
          key: "fix-price",
          title: "Fix price",
          description: "Fix price(cents) in src/server/price.ts.",
          workspace: "Backend",
          dependsOn: [],
          targetPaths: ["src/server/price.ts"],
          acceptance: ["src/server/price.test.ts passes"],
        },
        {
          key: "badge",
          title: "Badge",
          description: "Add badge(amount) in src/app/badge.ts with a unit test.",
          workspace: "Frontend",
          dependsOn: [],
          targetPaths: ["src/app/badge.ts"],
          acceptance: ["src/app/badge.test.ts passes"],
        },
      ],
    };
    const edits = {
      "Fix price(cents)": {
        edits: [{ tool: "Write", file: "src/server/price.ts", content: PRICE }],
      },
      "Add badge(amount)": {
        edits: [
          { tool: "Write", file: "src/app/badge.ts", content: BADGE },
          { tool: "Write", file: "src/app/badge.test.ts", content: BADGE_TEST },
        ],
      },
    };
    const planned = await plan(project, "Fix prices and add a badge", body, edits);
    expect((await api.post(`/api/orchestrations/${planned.id}/approve`)).status).toBe(200);
    const finished = await waitForPlan(
      planned.id,
      (entry) => !["RUNNING", "VERIFYING", "AWAITING_APPROVAL"].includes(entry.status),
      180_000,
    );
    expect(finished.status).toBe("COMPLETED");
    expect(finished.nodes.map((node) => [node.key, node.state])).toEqual([
      ["fix-price", "merged"],
      ["badge", "merged"],
    ]);
    const loops = await context.container.prisma.tddLoop.findMany({
      where: { task: { parentTaskId: finished.rootTaskId } },
      include: { task: { select: { planKey: true } } },
    });
    const message = (key: string) => loops.find((loop) => loop.task.planKey === key)?.message ?? "";
    expect(message("badge")).toContain("ignored 2 failures that already failed before this work");
    expect(message("badge")).toContain("src/server/price.test.ts › converts cents");
    expect(message("fix-price")).toContain("ignored 1 failure");
    expect(message("fix-price")).toContain("src/server/legacy.test.ts › is still broken");
    expect(message("fix-price")).not.toContain("price.test.ts");
    const verification = await api.get<TddLoopDto>(`/api/tdd-loops/${finished.verifyLoopId}`);
    expect(verification.body.status).toBe("GREEN");
    expect(verification.body.message).toContain("src/server/legacy.test.ts › is still broken");
    const worktrees = join(context.dataDir, "worktrees", project.id, planned.id);
    expect(existsSync(worktrees) ? readdirSync(worktrees) : []).toEqual([]);
  }, 240_000);

  it("still fails a node that leaves its own test red", async () => {
    createRepo(
      "stubborn-shop",
      {
        "package.json": JSON.stringify({
          name: "stubborn-shop",
          type: "module",
          private: true,
          devDependencies: { vitest: "*" },
        }),
        "tsconfig.json": TSCONFIG,
        "src/server/price.ts":
          "export function price(cents: number): number {\n  return cents;\n}\n",
        "src/server/price.test.ts": PRICE_TEST,
      },
      true,
    );
    const project = await registerProject("stubborn-shop");
    const body = {
      summary: "Fix the price conversion.",
      tasks: [
        {
          key: "fix-price",
          title: "Fix price",
          description: "Repair price(cents) in src/server/price.ts.",
          workspace: "Backend",
          dependsOn: [],
          targetPaths: ["src/server/price.ts"],
          acceptance: ["src/server/price.test.ts passes"],
        },
      ],
    };
    const planned = await plan(project, "Fix prices", body, {
      "Repair price(cents)": { edits: [] },
    });
    expect((await api.post(`/api/orchestrations/${planned.id}/approve`)).status).toBe(200);
    const finished = await waitForPlan(
      planned.id,
      (entry) => !["RUNNING", "VERIFYING", "AWAITING_APPROVAL"].includes(entry.status),
      180_000,
    );
    expect(finished.status).toBe("FAILED");
    expect(finished.nodes[0]?.state).toBe("failed");
    expect(finished.nodes[0]?.message).toContain("The tests did not pass");
  }, 240_000);

  it("asks how to handle a merge conflict, then resumes the plan", async () => {
    const root = createRepo(
      "clash",
      { "src/app/shared.ts": "export const label = 'base';\n", "README.md": "# Clash\n" },
      false,
    );
    const project = await registerProject("clash");
    const body = {
      summary: "Two tasks that touch the same file.",
      tasks: [
        {
          key: "first",
          title: "First label",
          description: "Set the first label in src/app/shared.ts.",
          workspace: "Frontend",
          dependsOn: [],
          acceptance: [],
        },
        {
          key: "second",
          title: "Second label",
          description: "Set the second label in src/app/shared.ts.",
          workspace: "Frontend",
          dependsOn: [],
          acceptance: [],
        },
      ],
    };
    const edits = {
      "Set the first label": {
        edits: [
          { tool: "Write", file: "src/app/shared.ts", content: "export const label = 'first';\n" },
        ],
      },
      "Set the second label": {
        delayMs: 800,
        edits: [
          { tool: "Write", file: "src/app/shared.ts", content: "export const label = 'second';\n" },
        ],
      },
    };
    const planned = await plan(project, "Change the shared label twice", body, edits, {
      verify: false,
    });
    expect(planned.status).toBe("AWAITING_APPROVAL");
    expect((await api.post(`/api/orchestrations/${planned.id}/approve`)).status).toBe(200);

    const waiting = await waitForPlan(planned.id, (entry) =>
      entry.nodes.some((node) => node.state === "conflict"),
    );
    expect(waiting.status).toBe("RUNNING");
    const conflicted = waiting.nodes.find((node) => node.state === "conflict");
    expect(conflicted?.key).toBe("second");
    expect(conflicted?.message).toBe("Merge conflict in src/app/shared.ts");
    const merge = await waitFor(
      async () => (await pendingApprovals()).find((entry) => entry.kind === "MERGE"),
      (entry) => entry !== undefined,
    );
    expect(merge).toMatchObject({
      orchestrationId: planned.id,
      files: ["src/app/shared.ts"],
      approveLabel: "Retry the merge",
      rejectLabel: "Drop this task",
    });
    const paused = await waitForPlan(planned.id, (entry) => entry.message !== null);
    expect(paused.message).toBe("Waiting for a merge decision in Approvals");

    expect((await api.post(`/api/approvals/${merge?.id}/reject`)).status).toBe(200);
    const failed = await waitForPlan(planned.id, (entry) => entry.status === "FAILED");
    expect(failed.message).toBe("1 task failed: Second label");
    expect(failed.nodes.find((node) => node.key === "first")?.state).toBe("merged");

    writeFileSync(
      editsPath,
      JSON.stringify({
        "Set the first label": edits["Set the first label"],
        "Set the second label": {
          edits: [
            { tool: "Write", file: "src/app/second.ts", content: "export const second = true;\n" },
          ],
        },
      }),
    );
    const resumed = await api.post<OrchestrationDto>(`/api/orchestrations/${planned.id}/resume`);
    expect(resumed.status).toBe(200);
    expect(resumed.body.status).toBe("RUNNING");
    const completed = await waitForPlan(
      planned.id,
      (entry) => entry.status === "COMPLETED" || entry.status === "FAILED",
    );
    expect(completed.status).toBe("COMPLETED");
    const workBranch = completed.workBranch ?? "";
    expect(git(["show", `${workBranch}:src/app/shared.ts`], root)).toBe(
      "export const label = 'first';",
    );
    expect(git(["show", `${workBranch}:src/app/second.ts`], root)).toBe(
      "export const second = true;",
    );
    expect(
      (await pendingApprovals()).filter((entry) => entry.orchestrationId === planned.id),
    ).toEqual([]);
  }, 120_000);

  it("discards a rejected plan and cancels a running one", async () => {
    createRepo("notes", { "README.md": "# Notes\n" }, false);
    const project = await registerProject("notes");
    const body = {
      summary: "One slow task.",
      tasks: [
        {
          key: "slow",
          title: "Slow change",
          description: "Write the slow note.",
          workspace: "Backend",
          dependsOn: [],
          acceptance: [],
        },
      ],
    };
    const rejected = await plan(
      project,
      "Write a slow note somewhere",
      body,
      {},
      {
        verify: false,
      },
    );
    const discarded = await api.post<OrchestrationDto>(`/api/orchestrations/${rejected.id}/reject`);
    expect(discarded.body.status).toBe("CANCELLED");
    expect(discarded.body.nodes.every((node) => node.taskStatus === "CANCELLED")).toBe(true);
    expect((await api.post(`/api/orchestrations/${rejected.id}/approve`)).status).toBe(409);

    const running = await plan(
      project,
      "Write a slow note somewhere",
      body,
      { "Write the slow note": { scenario: "hang" } },
      { verify: false },
    );
    await api.post(`/api/orchestrations/${running.id}/approve`);
    await waitForPlan(running.id, (entry) => entry.nodes[0]?.taskStatus === "RUNNING");
    const cancelled = await api.post<OrchestrationDto>(`/api/orchestrations/${running.id}/cancel`);
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.status).toBe("CANCELLED");
    expect(cancelled.body.nodes[0]?.state).toBe("cancelled");
    expect(context.container.scheduler.activeCount).toBe(0);
    const worktrees = join(context.dataDir, "worktrees", project.id, running.id);
    expect(existsSync(worktrees) ? readdirSync(worktrees) : []).toEqual([]);
  }, 60_000);
});

describe("budgets", () => {
  let project: ProjectDetailDto;

  async function runTask(title: string, prompt = "Say hello", position = 0): Promise<TaskDto> {
    const workspace = project.workspaces[position];
    const created = await api.post<TaskDto>("/api/tasks", {
      projectId: project.id,
      workspaceId: workspace?.id,
      title,
      prompt,
      kind: "CHORE",
    });
    expect(created.status).toBe(201);
    const started = await api.post(`/api/tasks/${created.body.id}/run`, {});
    expect(started.status).toBe(202);
    return created.body;
  }

  async function taskStatus(id: string): Promise<TaskDto> {
    return (await api.get<TaskDto>(`/api/tasks/${id}`)).body;
  }

  it("holds runs over the soft limit until approved and refuses them over the hard limit", async () => {
    createRepo("budgeted", { "README.md": "# Budgeted\n" }, false);
    project = await registerProject("budgeted");
    const created = await api.post<BudgetDto>("/api/budgets", {
      scope: "PROJECT",
      projectId: project.id,
      period: "DAY",
      softUsd: 0.02,
      hardUsd: 0.06,
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ spentUsd: 0, level: "ok", projectName: "budgeted" });

    const first = await runTask("First");
    await waitFor(
      () => taskStatus(first.id),
      (task) => task.status === "COMPLETED",
    );
    const soft = await waitFor(
      async () => (await api.get<BudgetListResponse>("/api/budgets")).body.items[0],
      (budget) => budget?.level === "soft",
    );
    expect(soft?.spentUsd).toBeCloseTo(0.0418);
    const approval = await waitFor(
      async () => (await pendingApprovals()).find((entry) => entry.kind === "BUDGET"),
      (entry) => entry !== undefined,
    );
    expect(approval?.title).toBe("budgeted: soft budget of $0.02 passed");

    const held = await runTask("Second");
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect((await taskStatus(held.id)).status).toBe("QUEUED");
    expect(context.container.scheduler.queuedCount).toBe(1);
    const refused = await api.post(`/api/projects/${project.id}/orchestrations`, {
      goal: "Plan something while held",
    });
    expect(refused.status).toBe(409);

    await api.post(`/api/approvals/${approval?.id}/approve`);
    await waitFor(
      () => taskStatus(held.id),
      (task) => task.status === "COMPLETED",
    );
    const hard = await waitFor(
      async () => (await api.get<BudgetListResponse>("/api/budgets")).body.items[0],
      (budget) => budget?.level === "hard",
    );
    expect(hard?.softApproved).toBe(true);

    const denied = await runTask("Third");
    await waitFor(
      () => taskStatus(denied.id),
      (task) => task.status === "FAILED",
    );
    const failed = await context.container.prisma.task.findUniqueOrThrow({
      where: { id: denied.id },
    });
    expect(failed.resultSummary).toBe(
      `budgeted reached the hard budget of $0.06 for ${hard?.periodKey ?? ""} (spent $0.08)`,
    );

    const raised = await api.patch<BudgetDto>(`/api/budgets/${created.body.id}`, { hardUsd: 5 });
    expect(raised.body.level).toBe("soft");
    expect(raised.body.softApproved).toBe(true);
    expect((await api.delete(`/api/budgets/${created.body.id}`)).status).toBe(204);
    expect((await api.get<BudgetListResponse>("/api/budgets")).body.items).toEqual([]);
  }, 60_000);

  it("stops the runs already in flight when the hard limit is reached", async () => {
    createRepo("spender", { "README.md": "# Spender\n" }, false);
    project = await registerProject("spender");
    const budget = await api.post<BudgetDto>("/api/budgets", {
      scope: "PROJECT",
      projectId: project.id,
      period: "MONTH",
      softUsd: null,
      hardUsd: 0.06,
    });
    expect(budget.status).toBe(201);
    const hanging = await runTask("Hanging", "Wait forever [stub:hang]", 0);
    await waitFor(
      () => taskStatus(hanging.id),
      (task) => task.status === "RUNNING",
    );
    const first = await runTask("First", "Say hello", 1);
    await waitFor(
      () => taskStatus(first.id),
      (task) => task.status === "COMPLETED",
    );
    expect((await taskStatus(hanging.id)).status).toBe("RUNNING");
    const second = await runTask("Second", "Say hello", 1);
    await waitFor(
      () => taskStatus(second.id),
      (task) => task.status === "COMPLETED",
    );
    const stopped = await waitFor(
      () => taskStatus(hanging.id),
      (task) => task.status !== "RUNNING",
    );
    expect(stopped.lastRun?.status).toBe("ABORTED");
    await api.delete(`/api/budgets/${budget.body.id}`);
  }, 60_000);
});
