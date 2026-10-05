import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  copyFileSync,
  cpSync,
  existsSync,
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
import { isProcessAlive } from "@onyx/agent-runtime";
import type {
  OrchestrationDto,
  ProjectDetailDto,
  RoadmapGenerationDto,
  RunEventsResponse,
  ServerMessage,
  TaskDetailDto,
  TaskDto,
  TddLoopDto,
  TerminalDto,
} from "@onyx/contracts";
import { createTestDatabase, type TestDatabase } from "@onyx/db/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProcessLedger } from "../../src/infrastructure/process-ledger";
import {
  ORIGIN,
  apiClient,
  authenticate,
  createTestContext,
  waitFor,
  type ApiClient,
  type TestContext,
  type TestContextOptions,
} from "../helpers";

const apiDir = join(import.meta.dirname, "..", "..");
const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "Seed",
  GIT_AUTHOR_EMAIL: "seed@example.com",
  GIT_COMMITTER_NAME: "Seed",
  GIT_COMMITTER_EMAIL: "seed@example.com",
};
const NODE_MARKER = "This task is part of a plan for:";

const NOTES_PLAN = {
  summary: "Write two notes.",
  tasks: [
    {
      key: "alpha",
      title: "Alpha note",
      description: "Write the alpha note.",
      workspace: "Backend",
      dependsOn: [],
      acceptance: [],
    },
    {
      key: "beta",
      title: "Beta note",
      description: "Write the beta note.",
      workspace: "Backend",
      dependsOn: [],
      acceptance: [],
    },
  ],
};
const HANGING_EDITS = {
  "Write the alpha note": { scenario: "hang" },
  "Write the beta note": { scenario: "hang" },
};
const WORKING_EDITS = {
  "Write the alpha note": {
    edits: [{ tool: "Write", file: "notes/alpha.md", content: "alpha\n" }],
  },
  "Write the beta note": {
    edits: [{ tool: "Write", file: "notes/beta.md", content: "beta\n" }],
  },
};

const MATH = [
  "export function add(a: number, b: number): number {",
  "  return a - b;",
  "}",
  "",
].join("\n");
const MATH_TEST = [
  'import { expect, it } from "vitest";',
  'import { add } from "./math";',
  "",
  'it("adds", () => {',
  "  expect(add(2, 3)).toBe(5);",
  "});",
  "",
].join("\n");
const FIX_ADD = { edits: [{ tool: "Edit", file: "src/math.ts", find: "a - b", replace: "a + b" }] };

interface Phase {
  context: TestContext;
  api: ApiClient;
  cookie: string;
}

const scratchDirs: string[] = [];
const databases: TestDatabase[] = [];
const phases: TestContext[] = [];
const sleepers: number[] = [];

function scratch(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  scratchDirs.push(directory);
  return directory;
}

function freshDatabase(): TestDatabase {
  const database = createTestDatabase();
  databases.push(database);
  return database;
}

function git(args: string[], cwd: string): string {
  return execFileSync("git", args, { cwd, env: GIT_ENV }).toString().trim();
}

function writeFiles(root: string, files: Record<string, string>): void {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
}

function commitAll(root: string): void {
  git(["init", "-q", "-b", "main"], root);
  git(["add", "."], root);
  git(["commit", "-q", "-m", "initial"], root);
}

function linkPackage(root: string, name: string, bin: string, binTarget: string): void {
  const source = realpathSync(join(apiDir, "node_modules", name));
  mkdirSync(join(root, "node_modules", ".bin"), { recursive: true });
  symlinkSync(source, join(root, "node_modules", name));
  symlinkSync(join("..", name, binTarget), join(root, "node_modules", ".bin", bin));
}

function createNotesRepo(projectsDir: string): string {
  const root = join(projectsDir, "notes");
  writeFiles(root, { "README.md": "# Notes\n", ".gitignore": "node_modules\n" });
  commitAll(root);
  return root;
}

function createCalcRepo(projectsDir: string, name: string): string {
  const root = join(projectsDir, name);
  writeFiles(root, {
    "package.json": JSON.stringify({
      name,
      type: "module",
      private: true,
      devDependencies: { vitest: "*" },
    }),
    "src/math.ts": MATH,
    "src/math.test.ts": MATH_TEST,
    ".gitignore": "node_modules\n",
  });
  linkPackage(root, "vitest", "vitest", "vitest.mjs");
  commitAll(root);
  return root;
}

async function boot(options: TestContextOptions, cookie?: string): Promise<Phase> {
  const context = await createTestContext(options);
  phases.push(context);
  await context.app.listen({ host: "127.0.0.1", port: 0 });
  const address = context.app.server.address();
  if (address === null || typeof address === "string") throw new Error("API is not listening");
  context.container.config.internalApiUrl = `http://127.0.0.1:${address.port}`;
  const session = cookie ?? (await authenticate(context.app));
  return { context, api: apiClient(context.app, session), cookie: session };
}

async function crashState(context: TestContext): Promise<() => void> {
  const directory = scratch("onyx-crash-");
  const copy = join(directory, "onyx.db");
  await context.container.prisma.$executeRawUnsafe(`VACUUM INTO '${copy}'`);
  const runtimeDir = context.container.config.runtimeDir;
  const runtime = join(directory, "runtime");
  cpSync(runtimeDir, runtime, { recursive: true });
  return () => {
    for (const suffix of ["", "-wal", "-shm"])
      rmSync(`${context.database.path}${suffix}`, { force: true });
    copyFileSync(copy, context.database.path);
    rmSync(runtimeDir, { recursive: true, force: true });
    cpSync(runtime, runtimeDir, { recursive: true });
  };
}

async function registerProject(api: ApiClient, name: string, root: string) {
  const response = await api.post<ProjectDetailDto>("/api/projects", { name, rootPath: root });
  expect(response.status).toBe(201);
  return response.body;
}

async function createTask(
  api: ApiClient,
  project: ProjectDetailDto,
  title: string,
  prompt: string,
  extra: Record<string, unknown> = {},
): Promise<TaskDto> {
  const response = await api.post<TaskDto>("/api/tasks", {
    projectId: project.id,
    workspaceId: project.workspaces[0]?.id,
    title,
    prompt,
    kind: "FEATURE",
    ...extra,
  });
  expect(response.status).toBe(201);
  return response.body;
}

async function taskDetail(api: ApiClient, id: string): Promise<TaskDetailDto> {
  return (await api.get<TaskDetailDto>(`/api/tasks/${id}`)).body;
}

async function waitForPlan(
  api: ApiClient,
  id: string,
  accept: (plan: OrchestrationDto) => boolean,
  timeoutMs = 60_000,
): Promise<OrchestrationDto> {
  return waitFor(
    async () => (await api.get<OrchestrationDto>(`/api/orchestrations/${id}`)).body,
    accept,
    timeoutMs,
  );
}

async function waitForLoop(api: ApiClient, id: string): Promise<TddLoopDto> {
  return waitFor(
    async () => (await api.get<TddLoopDto>(`/api/tdd-loops/${id}`)).body,
    (loop) => loop.status !== "RUNNING" && loop.status !== "PENDING",
    120_000,
  );
}

async function converse(phase: Phase, terminalId: string, input: string | null): Promise<void> {
  const output: string[] = [];
  const socket = await phase.context.app.injectWS("/ws", {
    headers: { cookie: phase.cookie, origin: ORIGIN },
  });
  socket.on("message", (data) => {
    const message = JSON.parse(data.toString()) as ServerMessage;
    if (message.type === "pty.output") output.push(message.data.data);
  });
  const send = (message: object) => socket.send(JSON.stringify({ v: 1, ...message }));
  const screen = (pattern: RegExp) =>
    waitFor(
      () => Promise.resolve(output.join("")),
      (text) => pattern.test(text),
      15_000,
    );
  send({ type: "subscribe", data: { channels: [`pty:${terminalId}`] } });
  try {
    await screen(/session [0-9a-f-]+[\s\S]*> /);
    if (input !== null) {
      send({ type: "pty.input", data: { terminalId, data: `${input}\r` } });
      await screen(new RegExp(`Stub reply: ${input}`));
    }
  } finally {
    socket.terminate();
  }
}

async function waitUntilDead(pid: number): Promise<void> {
  await waitFor(
    () => Promise.resolve(isProcessAlive(pid)),
    (alive) => !alive,
    5_000,
  );
}

interface CrashedPlan {
  database: TestDatabase;
  dataDir: string;
  root: string;
  project: ProjectDetailDto;
  planId: string;
  queuedKey: string;
  cookie: string;
  env: Record<string, string>;
  editsPath: string;
}

async function crashMidPlan(): Promise<CrashedPlan> {
  const fixtures = scratch("onyx-plan-fixtures-");
  const planPath = join(fixtures, "plan.json");
  const editsPath = join(fixtures, "edits.json");
  writeFileSync(planPath, JSON.stringify(NOTES_PLAN));
  writeFileSync(editsPath, JSON.stringify(HANGING_EDITS));
  const env = { CLAUDE_STUB_PLAN: planPath, CLAUDE_STUB_EDITS: editsPath };
  const database = freshDatabase();
  const dataDir = scratch("onyx-restart-");
  const first = await boot({ database, dataDir, maxConcurrent: 1, sourceEnv: env });
  const root = createNotesRepo(first.context.projectsDir);
  const project = await registerProject(first.api, "notes", root);
  const created = await first.api.post<OrchestrationDto>(
    `/api/projects/${project.id}/orchestrations`,
    { goal: "Write two short notes in the repository", parallelism: 2, verify: false },
  );
  expect(created.status).toBe(201);
  await waitForPlan(first.api, created.body.id, (plan) => plan.status === "AWAITING_APPROVAL");
  expect((await first.api.post(`/api/orchestrations/${created.body.id}/approve`)).status).toBe(200);
  const running = await waitForPlan(
    first.api,
    created.body.id,
    (plan) =>
      plan.nodes.some((node) => node.taskStatus === "RUNNING") &&
      plan.nodes.some((node) => node.taskStatus === "QUEUED"),
  );
  await waitFor(
    () =>
      first.context.container.prisma.agentRun.count({
        where: { status: "RUNNING", task: { parentTaskId: { not: null } } },
      }),
    (running) => running === 1,
  );
  const restore = await crashState(first.context);
  await first.context.close();
  restore();
  return {
    database,
    dataDir,
    root,
    project,
    planId: created.body.id,
    queuedKey: running.nodes.find((node) => node.taskStatus === "QUEUED")?.key ?? "",
    cookie: first.cookie,
    env,
    editsPath,
  };
}

afterEach(async () => {
  for (const context of phases.splice(0)) await context.close();
  for (const pid of sleepers.splice(0)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      continue;
    }
  }
  for (const database of databases.splice(0)) database.cleanup();
  for (const directory of scratchDirs.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe("restart in the middle of a plan", () => {
  it("hands the interrupted nodes back to the orchestrator and removes leftover worktrees (A10)", async () => {
    const crashed = await crashMidPlan();
    const worktrees = join(crashed.dataDir, "worktrees", crashed.project.id);
    const ghost = join(worktrees, "ghost-plan", "alpha");
    const baseline = join(worktrees, crashed.planId, "_baseline-0123456789ab");
    git(["worktree", "add", "-q", "--detach", ghost], crashed.root);
    git(["worktree", "add", "-q", "--detach", baseline], crashed.root);
    writeFileSync(crashed.editsPath, JSON.stringify(WORKING_EDITS));

    const second = await boot(
      {
        database: crashed.database,
        dataDir: crashed.dataDir,
        maxConcurrent: 1,
        sourceEnv: crashed.env,
      },
      crashed.cookie,
    );
    const report = second.context.container.recovery.lastReport();
    expect(report).toMatchObject({
      resumedPlans: 1,
      failedPlans: 0,
      releasedPlanNodes: 2,
      interruptedRuns: 1,
      requeuedTasks: 0,
      removedWorktrees: 2,
    });
    expect([...(report?.removed ?? [])].sort()).toEqual([baseline, ghost].sort());
    expect(report?.goneProcesses).toBeGreaterThanOrEqual(1);
    expect(existsSync(ghost)).toBe(false);
    expect(git(["worktree", "list", "--porcelain"], crashed.root)).not.toContain("ghost-plan");

    const finished = await waitForPlan(
      second.api,
      crashed.planId,
      (plan) => plan.status !== "RUNNING",
    );
    expect(finished.status, finished.message ?? "").toBe("COMPLETED");
    const prisma = second.context.container.prisma;
    for (const node of finished.nodes) {
      const runs = await prisma.agentRun.findMany({
        where: { taskId: node.taskId },
        orderBy: { startedAt: "asc" },
      });
      expect(runs.length).toBeGreaterThan(0);
      expect(runs.every((run) => run.prompt.includes(NODE_MARKER))).toBe(true);
      expect(runs.at(-1)?.status).toBe("COMPLETED");
    }
    const counts = await Promise.all(
      finished.nodes.map(async (node) => [
        node.key,
        await prisma.agentRun.count({ where: { taskId: node.taskId } }),
      ]),
    );
    expect(Object.fromEntries(counts)).toEqual({
      alpha: crashed.queuedKey === "alpha" ? 1 : 2,
      beta: crashed.queuedKey === "beta" ? 1 : 2,
    });
    expect(git(["show", `${finished.workBranch}:notes/beta.md`], crashed.root)).toBe("beta");
  }, 120_000);

  it("leaves the plan stopped when auto-resume is off, and Resume waits for a node's run", async () => {
    const crashed = await crashMidPlan();
    writeFileSync(crashed.editsPath, JSON.stringify(WORKING_EDITS));
    const second = await boot(
      {
        database: crashed.database,
        dataDir: crashed.dataDir,
        maxConcurrent: 1,
        sourceEnv: crashed.env,
        env: { AUTO_RESUME_QUEUED: "false" },
      },
      crashed.cookie,
    );
    const { container } = second.context;
    expect(container.recovery.lastReport()).toMatchObject({
      resumedPlans: 0,
      failedPlans: 1,
      releasedPlanNodes: 2,
      requeuedTasks: 0,
    });
    const stopped = (
      await second.api.get<OrchestrationDto>(`/api/orchestrations/${crashed.planId}`)
    ).body;
    expect(stopped.status).toBe("FAILED");
    expect(stopped.message).toBe("Interrupted by an Onyx restart: resume it to continue");
    expect(stopped.nodes.map((node) => [node.state, node.taskStatus])).toEqual([
      ["pending", "DRAFT"],
      ["pending", "DRAFT"],
    ]);
    expect(container.scheduler.queuedCount).toBe(0);
    expect(container.scheduler.activeCount).toBe(0);

    const alpha = stopped.nodes.find((node) => node.key === "alpha");
    if (!alpha?.workspaceId) throw new Error("The alpha node is missing");
    container.scheduler.enqueue({
      request: {
        taskId: alpha.taskId,
        modelId: null,
        agentConfigId: null,
        prompt: "Stray run [stub:hang]",
        newSession: false,
      },
      workspaceId: alpha.workspaceId,
      projectId: crashed.project.id,
      lockKey: `task:${alpha.taskId}`,
      priority: 0,
      enqueuedAt: Date.now(),
    });
    const stray = await waitFor(
      () =>
        container.prisma.agentRun.findFirst({
          where: { taskId: alpha.taskId, prompt: "Stray run [stub:hang]" },
        }),
      (run) => run?.status === "RUNNING",
    );

    const resumed = await second.api.post<OrchestrationDto>(
      `/api/orchestrations/${crashed.planId}/resume`,
    );
    expect(resumed.status).toBe(200);
    const settled = await container.prisma.agentRun.findUnique({ where: { id: stray?.id ?? "" } });
    expect(settled?.status).toBe("ABORTED");
    expect(settled?.endedAt).not.toBeNull();

    const finished = await waitForPlan(
      second.api,
      crashed.planId,
      (plan) => plan.status !== "RUNNING",
    );
    expect(finished.status, finished.message ?? "").toBe("COMPLETED");
    const last = await container.prisma.agentRun.findFirst({
      where: { taskId: alpha.taskId },
      orderBy: { startedAt: "desc" },
    });
    expect(last?.prompt).toContain(NODE_MARKER);
    expect(git(["show", `${finished.workBranch}:notes/alpha.md`], crashed.root)).toBe("alpha");
  }, 120_000);
});

describe("restart in the middle of a TDD loop", () => {
  it("restores the tests, closes the loop and lets a new loop reach green", async () => {
    const fixtures = scratch("onyx-tdd-restart-");
    const planPath = join(fixtures, "plan.json");
    writeFileSync(planPath, JSON.stringify([{ edits: [], hang: true }]));
    const env = { CLAUDE_STUB_TDD_PLAN: planPath };
    const database = freshDatabase();
    const dataDir = scratch("onyx-restart-");
    const first = await boot({ database, dataDir, sourceEnv: env });
    const root = createCalcRepo(first.context.projectsDir, "calc");
    const project = await registerProject(first.api, "calc", root);
    const task = await createTask(first.api, project, "Fix add", "Make add in src/math.ts right.", {
      kind: "BUGFIX",
      targetPaths: ["src/math.ts"],
    });
    const started = await first.api.post<TddLoopDto>(`/api/tasks/${task.id}/tdd`, {
      maxIterations: 3,
    });
    expect(started.status).toBe(201);
    await waitFor(
      () => first.context.container.prisma.agentRun.findFirst({ where: { taskId: task.id } }),
      (run) => run?.status === "RUNNING",
      60_000,
    );
    const restore = await crashState(first.context);
    await first.context.close();
    restore();
    writeFileSync(join(root, "src", "math.test.ts"), "it.skip('nothing to see', () => {});\n");

    writeFileSync(planPath, JSON.stringify([FIX_ADD]));
    const second = await boot({ database, dataDir, sourceEnv: env }, first.cookie);
    expect(second.context.container.recovery.lastReport()).toMatchObject({
      interruptedLoops: 1,
      interruptedRuns: 1,
    });
    const interrupted = (await second.api.get<TddLoopDto>(`/api/tdd-loops/${started.body.id}`))
      .body;
    expect(interrupted.status).toBe("ABORTED");
    expect(interrupted.message).toBe("Interrupted by an Onyx restart; restored 1 test file(s)");
    expect(readFileSync(join(root, "src", "math.test.ts"), "utf8")).toBe(MATH_TEST);
    const detail = await taskDetail(second.api, task.id);
    expect(detail.status).toBe("INTERRUPTED");
    expect(detail.runs[0]?.status).toBe("INTERRUPTED");
    expect(second.context.container.scheduler.isWorkspaceBusy(task.workspaceId ?? "")).toBe(false);

    const again = await second.api.post<TddLoopDto>(`/api/tasks/${task.id}/tdd`, {
      maxIterations: 3,
    });
    expect(again.status).toBe(201);
    const loop = await waitForLoop(second.api, again.body.id);
    expect(loop.status, loop.message ?? "").toBe("GREEN");
  }, 180_000);

  it("retries a fix run in a new session when Claude Code lost the session (M26)", async () => {
    const fixtures = scratch("onyx-tdd-lost-");
    const planPath = join(fixtures, "plan.json");
    writeFileSync(planPath, "[]");
    const phase = await boot({
      database: freshDatabase(),
      dataDir: scratch("onyx-restart-"),
      sourceEnv: { CLAUDE_STUB_TDD_PLAN: planPath },
    });
    const root = createCalcRepo(phase.context.projectsDir, "lost");
    const project = await registerProject(phase.api, "lost", root);
    const task = await createTask(
      phase.api,
      project,
      "Fix add",
      "Make add in src/math.ts right [stub:tdd-lost-session]",
      { kind: "BUGFIX", targetPaths: ["src/math.ts"] },
    );
    expect(
      (await phase.api.post(`/api/tasks/${task.id}/run`, { modelId: "claude-sonnet-5-5" })).status,
    ).toBe(202);
    await waitFor(
      () => taskDetail(phase.api, task.id),
      (detail) => detail.status === "COMPLETED",
    );

    writeFileSync(planPath, JSON.stringify([FIX_ADD]));
    const started = await phase.api.post<TddLoopDto>(`/api/tasks/${task.id}/tdd`, {
      maxIterations: 3,
    });
    expect(started.status).toBe(201);
    const loop = await waitForLoop(phase.api, started.body.id);
    expect(loop.status, loop.message ?? "").toBe("GREEN");
    expect(loop.iterationCount).toBe(1);

    const runs = await phase.context.container.prisma.agentRun.findMany({
      where: { taskId: task.id },
      orderBy: { startedAt: "asc" },
    });
    expect(runs.map((run) => run.status)).toEqual(["COMPLETED", "FAILED", "COMPLETED"]);
    expect(runs[1]?.errorMessage).toContain("No conversation found");
    expect(runs[2]?.sessionId).not.toBe(runs[1]?.sessionId);
    expect(loop.iterations[0]?.agentRunId).toBe(runs[2]?.id);
  }, 180_000);
});

describe("restart with a running terminal", () => {
  it("resumes the terminal session once and starts fresh if it was lost, without loops", async () => {
    const transcripts = scratch("onyx-transcripts-");
    const env = { CLAUDE_STUB_TRANSCRIPTS: transcripts };
    const database = freshDatabase();
    const dataDir = scratch("onyx-restart-");
    const first = await boot({ database, dataDir, sourceEnv: env });
    const project = await registerProject(first.api, "demo", first.context.projectRoot);
    const workspaceId = project.workspaces[0]?.id ?? "";
    const opened = (
      await first.api.post<TerminalDto>(`/api/workspaces/${workspaceId}/terminal`, { fresh: true })
    ).body;
    await waitFor(
      async () => (await first.api.get<TerminalDto>(`/api/terminals/${opened.id}`)).body,
      (terminal) => terminal.claudeSessionId === opened.sessionId,
    );
    await converse(first, opened.id, "Remember the parser");
    expect(first.context.container.ledger.records().map((record) => record.label)).toContain(
      `terminal:${opened.id}`,
    );
    const restore = await crashState(first.context);
    await first.context.close();
    restore();

    const second = await boot({ database, dataDir, sourceEnv: env }, first.cookie);
    const { container } = second.context;
    expect(container.recovery.lastReport()?.goneProcesses).toBeGreaterThanOrEqual(1);
    expect(container.ledger.records()).toEqual([]);
    const session = await container.prisma.session.findUnique({ where: { id: opened.sessionId } });
    expect(session?.status).toBe("IDLE");

    const terminal = async (id: string) =>
      (await second.api.get<TerminalDto>(`/api/terminals/${id}`)).body;
    const resumed = (
      await second.api.post<TerminalDto>(`/api/workspaces/${workspaceId}/terminal`, {})
    ).body;
    expect(resumed.sessionId).toBe(opened.sessionId);
    const running = await waitFor(
      () => terminal(resumed.id),
      (dto) => dto.claudeSessionId === opened.sessionId,
    );
    expect(running.state).toBe("running");
    await converse(second, resumed.id, null);
    await second.api.delete(`/api/terminals/${resumed.id}`);
    expect(
      await container.prisma.session.findUnique({ where: { id: opened.sessionId } }),
    ).toMatchObject({ status: "IDLE" });

    rmSync(join(transcripts, opened.sessionId), { force: true });
    const lost = (await second.api.post<TerminalDto>(`/api/workspaces/${workspaceId}/terminal`, {}))
      .body;
    expect(lost.sessionId).toBe(opened.sessionId);
    await waitFor(
      () => terminal(lost.id),
      (dto) => dto.state === "exited",
      15_000,
    );
    const fresh = (
      await second.api.post<TerminalDto>(`/api/workspaces/${workspaceId}/terminal`, {})
    ).body;
    expect(fresh.sessionId).not.toBe(opened.sessionId);
    const started = await waitFor(
      () => terminal(fresh.id),
      (dto) => dto.claudeSessionId === fresh.sessionId,
    );
    expect(started.state).toBe("running");
    await second.api.delete(`/api/terminals/${fresh.id}`);
  }, 90_000);
});

describe("queued requests and failed preparations", () => {
  it("keeps the follow-up prompt of a queued run across a restart (M9)", async () => {
    const database = freshDatabase();
    const dataDir = scratch("onyx-restart-");
    const first = await boot({ database, dataDir, maxConcurrent: 1 });
    const project = await registerProject(first.api, "demo", first.context.projectRoot);
    const holder = await createTask(first.api, project, "Holder", "Hold the slot [stub:hang]");
    expect((await first.api.post(`/api/tasks/${holder.id}/run`, {})).status).toBe(202);
    await waitFor(
      () => taskDetail(first.api, holder.id),
      (detail) => detail.status === "RUNNING",
    );
    const task = await createTask(first.api, project, "Follow-up", "Original request [stub:quick]");
    const followUp = "Allowed: carry on with the change [stub:quick]";
    expect((await first.api.post(`/api/tasks/${task.id}/run`, { prompt: followUp })).status).toBe(
      202,
    );
    const stored = await first.context.container.prisma.task.findUnique({ where: { id: task.id } });
    expect(stored?.pendingRun).toMatchObject({ prompt: followUp });
    await first.context.close();

    const second = await boot({ database, dataDir, maxConcurrent: 1 }, first.cookie);
    expect(second.context.container.recovery.lastReport()).toMatchObject({
      requeuedTasks: 1,
      restoredRequests: 1,
    });
    const done = await waitFor(
      () => taskDetail(second.api, task.id),
      (detail) => detail.status === "COMPLETED",
    );
    expect(done.runs).toHaveLength(1);
    const run = await second.context.container.prisma.agentRun.findFirst({
      where: { taskId: task.id },
    });
    expect(run?.prompt).toBe(followUp);
    const cleared = await second.context.container.prisma.task.findUnique({
      where: { id: task.id },
    });
    expect(cleared?.pendingRun).toBeNull();
    expect((await taskDetail(second.api, holder.id)).status).toBe("INTERRUPTED");
    expect(second.context.container.ledger.records()).toEqual([]);
  }, 60_000);

  it("closes a run that fails while preparing and keeps the handoff note (M4)", async () => {
    const phase = await boot({ database: freshDatabase(), dataDir: scratch("onyx-restart-") });
    const { container } = phase.context;
    const project = await registerProject(phase.api, "demo", phase.context.projectRoot);
    const workspaceId = project.workspaces[0]?.id ?? "";
    const sessionId = randomUUID();
    await container.prisma.session.create({
      data: {
        id: sessionId,
        workspaceId,
        modelId: "claude-sonnet-5-5",
        status: "IDLE",
        handoffNote: "Handoff: the parser is half done",
        handoffTokens: 8,
      },
    });
    await container.prisma.workspace.update({
      where: { id: workspaceId },
      data: { activeSessionId: sessionId },
    });
    const issued = vi.spyOn(container.runTokens, "issue");
    const childEnv = vi
      .spyOn(container.credentials, "childEnv")
      .mockRejectedValueOnce(new Error("Credential store unavailable"));
    const task = await createTask(phase.api, project, "Parser", "Finish the parser [stub:quick]");
    expect((await phase.api.post(`/api/tasks/${task.id}/run`, {})).status).toBe(202);
    const failed = await waitFor(
      () => taskDetail(phase.api, task.id),
      (detail) => detail.status === "FAILED",
    );
    expect(failed.runs).toHaveLength(1);
    expect(failed.runs[0]?.status).toBe("FAILED");
    const run = await container.prisma.agentRun.findFirst({ where: { taskId: task.id } });
    expect(run).toMatchObject({
      status: "FAILED",
      isError: true,
      errorMessage: "Credential store unavailable",
      sessionId,
    });
    expect(run?.endedAt).not.toBeNull();
    const index = issued.mock.calls.findIndex(([runId]) => runId === run?.id);
    const token = issued.mock.results[index]?.value as string;
    expect(container.runTokens.resolve(token)).toBeNull();
    const events = await phase.api.get<RunEventsResponse>(`/api/runs/${run?.id}/events`);
    expect(events.body.items.at(-1)?.items[0]).toMatchObject({ kind: "status", status: "FAILED" });
    const session = await container.prisma.session.findUnique({ where: { id: sessionId } });
    expect(session).toMatchObject({
      status: "IDLE",
      handoffNote: "Handoff: the parser is half done",
    });
    expect(container.scheduler.activeCount).toBe(0);
    childEnv.mockRestore();
    issued.mockRestore();

    expect((await phase.api.post(`/api/tasks/${task.id}/run`, {})).status).toBe(202);
    await waitFor(
      () => taskDetail(phase.api, task.id),
      (detail) => detail.status === "COMPLETED",
    );
    const second = await container.prisma.agentRun.findFirst({
      where: { taskId: task.id, status: "COMPLETED" },
    });
    expect(second?.sessionId).toBe(sessionId);
    const replay = await phase.api.get<RunEventsResponse>(`/api/runs/${second?.id}/events`);
    const sessionItem = replay.body.items
      .flatMap((event) => event.items)
      .find((item) => item.kind === "session");
    expect(sessionItem).toMatchObject({
      action: "started",
      handoff: { text: "Handoff: the parser is half done" },
    });
  }, 60_000);
});

describe("work that is still preparing", () => {
  it("cancels a plan and stops a roadmap while they wait for the index (A11)", async () => {
    const phase = await boot({ database: freshDatabase(), dataDir: scratch("onyx-restart-") });
    const { container } = phase.context;
    const project = await registerProject(phase.api, "demo", phase.context.projectRoot);
    const waiting = vi
      .spyOn(container.indexes, "waitForIndex")
      .mockImplementation(() => new Promise(() => undefined));
    const runs = vi.spyOn(container.pool, "run");

    const created = await phase.api.post<OrchestrationDto>(
      `/api/projects/${project.id}/orchestrations`,
      { goal: "Write two short notes in the repository", verify: false },
    );
    expect(created.body.status).toBe("PLANNING");
    await waitFor(
      () => Promise.resolve(waiting.mock.calls.length),
      (calls) => calls > 0,
    );
    const cancelled = await phase.api.post<OrchestrationDto>(
      `/api/orchestrations/${created.body.id}/cancel`,
    );
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.status).toBe("CANCELLED");
    expect(container.scheduler.reservedCount).toBe(0);

    const generation = await phase.api.post<RoadmapGenerationDto>(
      `/api/projects/${project.id}/roadmap`,
      {},
    );
    expect(generation.status).toBe(202);
    await waitFor(
      () => Promise.resolve(waiting.mock.calls.length),
      (calls) => calls > 1,
    );
    await container.roadmap.shutdown();
    const stored = await container.prisma.roadmapGeneration.findUnique({
      where: { id: generation.body.id },
    });
    expect(stored).toMatchObject({ status: "FAILED", error: "The roadmap was interrupted" });
    expect(runs.mock.calls.map((call) => call[0].runId)).toEqual([]);
    waiting.mockRestore();
    runs.mockRestore();
  }, 60_000);
});

describe("processes left by a previous Onyx", () => {
  it("stops them at startup and reports what it cleaned", async () => {
    const dataDir = scratch("onyx-restart-");
    const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
    const pid = child.pid ?? 0;
    sleepers.push(pid);
    const exited = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
    await new Promise((resolve) => exited.once("exit", resolve));
    const ledger = new ProcessLedger(join(dataDir, "runtime", "processes"), {
      instance: "previous-onyx",
      ownerPid: exited.pid ?? 0,
    });
    ledger.started(pid, "test:orphan-loop");

    const phase = await boot({ database: freshDatabase(), dataDir });
    const report = phase.context.container.recovery.lastReport();
    expect(report).toMatchObject({ killedProcesses: 1, killed: [`test:orphan-loop (pid ${pid})`] });
    expect(report?.at).toEqual(expect.any(String));
    await waitUntilDead(pid);
    expect(phase.context.container.ledger.records()).toEqual([]);
  }, 30_000);
});
