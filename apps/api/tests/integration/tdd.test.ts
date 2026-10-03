import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type {
  ProjectDetailDto,
  RunEventsResponse,
  TaskDetailDto,
  TaskDto,
  TddDefaultsDto,
  TddLoopDto,
  TddLoopListResponse,
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

const MATH = [
  "export function add(a: number, b: number): number {",
  "  return a - b;",
  "}",
  "",
  "export function multiply(a: number, b: number): number {",
  "  return a + b;",
  "}",
  "",
].join("\n");

const MATH_TEST = [
  'import { describe, expect, it } from "vitest";',
  'import { add, multiply } from "./math";',
  "",
  'describe("math", () => {',
  '  it("adds", () => {',
  "    expect(add(2, 3)).toBe(5);",
  "  });",
  "",
  '  it("multiplies", () => {',
  "    expect(multiply(3, 4)).toBe(12);",
  "  });",
  "});",
  "",
].join("\n");

const UNCOMMITTED_CASE = [
  "",
  'describe("math, more cases", () => {',
  '  it("adds negatives", () => {',
  "    expect(add(-2, -3)).toBe(-5);",
  "  });",
  "});",
  "",
].join("\n");

const FORMAT = "export function label(value: number): string {\n  return `#${value}`;\n}\n";
const FORMAT_TEST = [
  'import { expect, it } from "vitest";',
  'import { label } from "./format";',
  "",
  'it("labels", () => {',
  '  expect(label(3)).toBe("#3");',
  "});",
  "",
].join("\n");

const SLOW_TEST = [
  'import { it } from "vitest";',
  "",
  'it("waits", async () => {',
  "  await new Promise((resolve) => setTimeout(resolve, 60_000));",
  "}, 120_000);",
  "",
].join("\n");

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

let fixtures: string;
let planPath: string;
let context: TestContext;
let api: ApiClient;

function git(args: string[], cwd: string): string {
  return execFileSync("git", args, { cwd, env: GIT_ENV }).toString().trim();
}

function linkPackage(root: string, name: string, bin: string, binTarget: string): void {
  const source = realpathSync(join(apiDir, "node_modules", name));
  mkdirSync(join(root, "node_modules", ".bin"), { recursive: true });
  symlinkSync(source, join(root, "node_modules", name));
  symlinkSync(join("..", name, binTarget), join(root, "node_modules", ".bin", bin));
}

function createProjectFiles(root: string, files: Record<string, string>): void {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  writeFileSync(join(root, ".gitignore"), "node_modules\n");
  linkPackage(root, "vitest", "vitest", "vitest.mjs");
  linkPackage(root, "typescript", "tsc", "bin/tsc");
  git(["init", "-q", "-b", "main"], root);
  git(["add", "."], root);
  git(["commit", "-q", "-m", "initial"], root);
}

async function registerProject(name: string): Promise<ProjectDetailDto> {
  const response = await api.post<ProjectDetailDto>("/api/projects", {
    name,
    rootPath: join(context.projectsDir, name),
  });
  expect(response.status).toBe(201);
  return response.body;
}

async function createTask(project: ProjectDetailDto, title: string): Promise<TaskDto> {
  const workspace = project.workspaces.find((entry) => entry.name === "Backend");
  const response = await api.post<TaskDto>("/api/tasks", {
    projectId: project.id,
    workspaceId: workspace?.id,
    title,
    prompt: "Make the math helpers in src/math.ts return the right results.",
    kind: "BUGFIX",
    targetPaths: ["src/math.ts"],
  });
  expect(response.status).toBe(201);
  return response.body;
}

function setPlan(steps: unknown[]): void {
  writeFileSync(planPath, JSON.stringify(steps));
}

async function waitForLoop(loopId: string, timeoutMs = 120_000): Promise<TddLoopDto> {
  return waitFor(
    async () => (await api.get<TddLoopDto>(`/api/tdd-loops/${loopId}`)).body,
    (loop) => loop.status !== "RUNNING" && loop.status !== "PENDING",
    timeoutMs,
  );
}

beforeAll(async () => {
  fixtures = mkdtempSync(join(tmpdir(), "onyx-tdd-"));
  planPath = join(fixtures, "plan.json");
  setPlan([]);
  context = await createTestContext({ sourceEnv: { CLAUDE_STUB_TDD_PLAN: planPath } });
  await context.app.listen({ host: "127.0.0.1", port: 0 });
  const address = context.app.server.address();
  if (address === null || typeof address === "string") throw new Error("API is not listening");
  context.container.config.internalApiUrl = `http://127.0.0.1:${address.port}`;
  api = apiClient(context.app, await authenticate(context.app));
  createProjectFiles(join(context.projectsDir, "calc"), {
    "package.json": JSON.stringify({
      name: "calc",
      type: "module",
      private: true,
      devDependencies: { vitest: "*" },
    }),
    "tsconfig.json": TSCONFIG,
    "src/math.ts": MATH,
    "src/math.test.ts": MATH_TEST,
    "src/format.ts": FORMAT,
    "src/format.test.ts": FORMAT_TEST,
  });
}, 60_000);

afterAll(async () => {
  await destroyTestContext(context);
  rmSync(fixtures, { recursive: true, force: true });
});

describe("TDD auto-loop", () => {
  let project: ProjectDetailDto;

  it("proposes defaults from the project", async () => {
    project = await registerProject("calc");
    const task = await createTask(project, "Defaults");
    const defaults = await api.get<TddDefaultsDto>(`/api/tasks/${task.id}/tdd/defaults`);
    expect(defaults.status).toBe(200);
    expect(defaults.body).toMatchObject({
      runner: "VITEST",
      baseCommand: "node_modules/.bin/vitest",
      relatedFiles: ["src/math.ts"],
      typecheckCommand: "node_modules/.bin/tsc --noEmit --pretty false",
      protectedFiles: 2,
      activeLoopId: null,
    });
    await api.delete(`/api/tasks/${task.id}`);
  });

  it("reaches green without touching the tests and reverts a cheating attempt", async () => {
    const root = join(context.projectsDir, "calc");
    const testPath = join(root, "src", "math.test.ts");
    writeFileSync(testPath, MATH_TEST + UNCOMMITTED_CASE);
    const userTests = readFileSync(testPath, "utf8");
    setPlan([
      { edits: [{ tool: "Edit", file: "src/math.ts", find: "a - b", replace: "a + b" }] },
      {
        edits: [{ tool: "Bash", file: "src/math.test.ts", find: "toBe(12)", replace: "toBe(7)" }],
        text: "Adjusted the expectation.",
      },
      {
        edits: [
          { tool: "Edit", file: "src/math.test.ts", find: "toBe(12)", replace: "toBe(7)" },
          { tool: "Bash", command: "npx vitest run src/math.test.ts" },
          {
            tool: "Edit",
            file: "src/math.ts",
            find: "multiply(a: number, b: number): number {\n  return a + b;",
            replace: "multiply(a: number, b: number): number {\n  return a * b;",
          },
        ],
      },
    ]);
    const task = await createTask(project, "Fix the math helpers");
    const started = await api.post<TddLoopDto>(`/api/tasks/${task.id}/tdd`, { maxIterations: 6 });
    expect(started.status).toBe(201);
    expect(started.body).toMatchObject({
      runner: "VITEST",
      status: "RUNNING",
      protectedFiles: 2,
      relatedFiles: ["src/math.test.ts", "src/math.ts"],
      gates: { typecheck: "node_modules/.bin/tsc --noEmit --pretty false", lint: null },
    });
    expect(
      (await api.post(`/api/tasks/${task.id}/run`, {})).status,
      "a task inside a loop cannot be queued again",
    ).toBe(409);

    const loop = await waitForLoop(started.body.id);
    expect(loop.status, loop.message ?? "").toBe("GREEN");
    expect(loop.iterationCount).toBe(3);
    expect(loop.violations).toBe(1);
    expect(loop.greenAt).not.toBeNull();
    expect(readFileSync(testPath, "utf8")).toBe(userTests);
    expect(readFileSync(join(root, "src", "math.ts"), "utf8")).toContain("return a * b;");

    expect(loop.iterations.map((iteration) => [iteration.scope, iteration.failed])).toEqual([
      ["related", 3],
      ["related", 1],
      ["guard", 1],
      ["full", 0],
    ]);
    const first = loop.iterations[0];
    expect(first?.digest).toContain("src/math.test.ts › math › multiplies");
    expect(first?.digest).toContain("> 6 |     expect(add(2, 3)).toBe(5);");
    expect(first?.digest).not.toContain("node_modules");
    expect(first?.failureSignature).toMatch(/^[0-9a-f]{64}$/);
    expect(first?.agentRunId).not.toBeNull();
    const guard = loop.iterations[2];
    expect(guard?.revertedFiles).toEqual(["src/math.test.ts"]);
    expect(guard?.agentRunId).not.toBeNull();
    const last = loop.iterations.at(-1);
    expect(last?.failed).toBe(0);
    expect(last?.agentRunId).toBeNull();

    const detail = (await api.get<TaskDetailDto>(`/api/tasks/${task.id}`)).body;
    expect(detail.status).toBe("COMPLETED");
    expect(detail.runs).toHaveLength(3);
    const thirdRun = detail.runs.find((run) => run.id === guard?.agentRunId);
    expect(thirdRun?.guardDenials).toBe(2);
    const events = await api.get<RunEventsResponse>(`/api/runs/${guard?.agentRunId}/events`);
    const guards = events.body.items
      .flatMap((event) => event.items)
      .filter((item) => item.kind === "guard" && item.source === "hook");
    expect(guards.map((item) => (item.kind === "guard" ? item.rule : null))).toEqual([
      "TDD loop: protected tests",
      "TDD loop: test commands",
    ]);

    const decisions = await context.container.prisma.routingDecision.findMany({
      where: { taskId: task.id },
      include: { rule: true },
    });
    expect(decisions.every((decision) => decision.rule?.name === "test-fixing")).toBe(true);

    const audit = await context.container.prisma.auditLog.findMany({
      where: { action: { in: ["tdd.test_reverted", "tdd.denied", "tdd.started"] } },
    });
    expect(audit.filter((entry) => entry.action === "tdd.test_reverted")).toHaveLength(1);
    expect(audit.filter((entry) => entry.action === "tdd.denied")).toHaveLength(2);

    const settings = JSON.parse(
      readFileSync(
        join(context.container.config.runtimeDir, detail.runs[0]?.id ?? "", "settings.json"),
        "utf8",
      ),
    ) as { permissions: { deny: string[] } };
    expect(settings.permissions.deny).toEqual(
      expect.arrayContaining([`Edit(/${root}/**/*.test.*)`, "Bash(npx vitest *)"]),
    );
  }, 180_000);

  it("escalates after two attempts without progress and stops when stalled", async () => {
    const root = join(context.projectsDir, "calc");
    execFileSync("git", ["checkout", "--", "src/math.ts"], { cwd: root });
    setPlan([]);
    const task = await createTask(project, "Stubborn bug");
    const started = await api.post<TddLoopDto>(`/api/tasks/${task.id}/tdd`, {
      maxIterations: 6,
      typecheck: false,
    });
    expect(started.status).toBe(201);
    const loop = await waitForLoop(started.body.id);
    expect(loop.status, loop.message ?? "").toBe("STALLED");
    expect(loop.iterationCount).toBe(5);
    expect(loop.escalatedAt).not.toBeNull();
    expect(loop.iterations.map((iteration) => iteration.escalated)).toEqual([
      false,
      false,
      true,
      false,
      false,
      false,
    ]);
    const signatures = new Set(loop.iterations.map((iteration) => iteration.failureSignature));
    expect(signatures.size).toBe(1);

    const decisions = await context.container.prisma.routingDecision.findMany({
      where: { taskId: task.id },
      orderBy: { createdAt: "asc" },
    });
    expect(decisions.map((decision) => [decision.strategy, decision.tier])).toEqual([
      ["RULE", "BUILDER"],
      ["RULE", "BUILDER"],
      ["ESCALATION", "ARCHITECT"],
      ["ESCALATION", "ARCHITECT"],
      ["ESCALATION", "ARCHITECT"],
    ]);
    const detail = (await api.get<TaskDetailDto>(`/api/tasks/${task.id}`)).body;
    expect(detail.status).toBe("FAILED");
  }, 180_000);

  it("stops at the iteration limit", async () => {
    setPlan([]);
    const task = await createTask(project, "Limited");
    const started = await api.post<TddLoopDto>(`/api/tasks/${task.id}/tdd`, {
      maxIterations: 2,
      typecheck: false,
    });
    const loop = await waitForLoop(started.body.id);
    expect(loop.status).toBe("EXHAUSTED");
    expect(loop.iterationCount).toBe(2);
    expect(loop.message).toContain("2 fix attempts");
    const list = await api.get<TddLoopListResponse>(`/api/tasks/${task.id}/tdd`);
    expect(list.body.items.map((item) => item.id)).toEqual([started.body.id]);
  }, 120_000);

  it("can be aborted while the tests run, and blocks the workspace meanwhile", async () => {
    const root = join(context.projectsDir, "slow");
    createProjectFiles(root, {
      "package.json": JSON.stringify({ name: "slow", type: "module", private: true }),
      "src/math.ts": MATH,
      "src/slow.test.ts": SLOW_TEST,
    });
    const slow = await registerProject("slow");
    const task = await createTask(slow, "Slow suite");
    const started = await api.post<TddLoopDto>(`/api/tasks/${task.id}/tdd`, {
      runner: "VITEST",
      relatedFiles: [],
    });
    expect(started.status).toBe(201);
    await waitFor(
      async () => (await api.get<TddLoopDto>(`/api/tdd-loops/${started.body.id}`)).body,
      (loop) => loop.phase === "tests",
    );
    const other = await createTask(slow, "Another task");
    expect((await api.post(`/api/tasks/${other.id}/tdd`, { runner: "VITEST" })).status).toBe(409);
    const aborted = await api.post<TddLoopDto>(`/api/tdd-loops/${started.body.id}/abort`);
    expect(aborted.status).toBe(200);
    expect(aborted.body.status).toBe("ABORTED");
    const detail = (await api.get<TaskDetailDto>(`/api/tasks/${task.id}`)).body;
    expect(detail.status).toBe("CANCELLED");
  }, 120_000);

  it("refuses a project without a test runner", async () => {
    const root = join(context.projectsDir, "plain");
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src", "math.ts"), MATH);
    const plain = await registerProject("plain");
    const task = await createTask(plain, "No runner");
    const response = await api.post<{ error: { message: string } }>(
      `/api/tasks/${task.id}/tdd`,
      {},
    );
    expect(response.status).toBe(400);
    expect(response.body.error.message).toContain("No test runner found");
  });
});
