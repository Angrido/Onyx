import type {
  MemorySettings,
  ProjectDetailDto,
  ProjectMemoryDto,
  SavingsReport,
  TaskDetailDto,
  TaskDto,
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

let context: TestContext;
let api: ApiClient;
let project: ProjectDetailDto;
let random = 0.9;

const PROMPT = "[stub:guard] bash:{pnpm test} read:src/math.ts fail:{pnpm build}";

async function run(title: string, prompt = PROMPT, newSession = false): Promise<TaskDetailDto> {
  const task = (
    await api.post<TaskDto>("/api/tasks", {
      projectId: project.id,
      workspaceId: project.workspaces[0]?.id,
      title,
      prompt,
    })
  ).body;
  await api.post(`/api/tasks/${task.id}/run`, newSession ? { newSession: true } : {});
  const detail = await waitFor(
    async () => (await api.get<TaskDetailDto>(`/api/tasks/${task.id}`)).body,
    (entry) => entry.status === "COMPLETED" || entry.status === "FAILED",
    20_000,
  );
  await context.container.scheduler.idle();
  await new Promise((resolve) => setTimeout(resolve, 100));
  return detail;
}

async function memory(): Promise<ProjectMemoryDto> {
  return (await api.get<ProjectMemoryDto>(`/api/projects/${project.id}/memory`)).body;
}

function fact(state: ProjectMemoryDto, subject: string) {
  return state.facts.find((entry) => entry.subject === subject);
}

beforeAll(async () => {
  context = await createTestContext({ armRandom: () => random });
  api = apiClient(context.app, await authenticate(context.app));
  project = (
    await api.post<ProjectDetailDto>("/api/projects", {
      name: "shop",
      rootPath: context.projectRoot,
    })
  ).body;
  await context.container.indexes.idle(project.id);
});

afterAll(async () => {
  await destroyTestContext(context);
});

describe("project memory", () => {
  it("learns from runs and promotes facts as they repeat", async () => {
    const first = await run("First");
    let state = await memory();
    expect(fact(state, "pnpm test")).toMatchObject({
      kind: "COMMAND",
      status: "ACTIVE",
      evidence: 1,
      sourceRunId: first.runs[0]?.id,
      sourceTaskTitle: "First",
      included: true,
    });
    expect(fact(state, "src/math.ts")).toBeUndefined();
    expect(state.preview?.text).toContain("`pnpm test` works");

    await run("Second");
    await run("Third");
    state = await memory();
    expect(fact(state, "pnpm test")?.evidence).toBe(3);
    expect(fact(state, "src/math.ts")).toMatchObject({
      kind: "FILE",
      status: "ACTIVE",
      evidence: 3,
    });
    const pitfall = fact(state, "pnpm build");
    expect(pitfall).toMatchObject({ kind: "PITFALL", status: "SUGGESTED", included: false });
    expect(pitfall?.detail).toContain("Cannot find module");
    expect(pitfall?.expiresAt).not.toBeNull();
  });

  it("can be curated: confirm, pin, edit, note and dismiss", async () => {
    let state = await memory();
    const pitfall = fact(state, "pnpm build");
    const command = fact(state, "pnpm test");
    state = (
      await api.patch<ProjectMemoryDto>(`/api/projects/${project.id}/memory/facts/${pitfall?.id}`, {
        status: "ACTIVE",
      })
    ).body;
    expect(fact(state, "pnpm build")?.included).toBe(true);
    state = (
      await api.patch<ProjectMemoryDto>(`/api/projects/${project.id}/memory/facts/${command?.id}`, {
        pinned: true,
        text: "Run the tests with `pnpm test`",
      })
    ).body;
    expect(fact(state, "pnpm test")).toMatchObject({ pinned: true, expiresAt: null });
    expect(state.preview?.text).toContain("- Run the tests with `pnpm test`");
    const note = await api.post<ProjectMemoryDto>(`/api/projects/${project.id}/memory/notes`, {
      text: "Prices are in cents",
    });
    expect(note.status).toBe(201);
    expect(note.body.preview?.text.split("\n").slice(2, 4)).toEqual([
      "- Prices are in cents",
      "- Run the tests with `pnpm test`",
    ]);

    const file = fact(note.body, "src/math.ts");
    state = (await api.delete(`/api/projects/${project.id}/memory/facts/${file?.id}`))
      .body as ProjectMemoryDto;
    expect(fact(state, "src/math.ts")?.status).toBe("DISMISSED");
    await run("Fourth");
    state = await memory();
    expect(fact(state, "src/math.ts")).toMatchObject({ status: "DISMISSED", evidence: 3 });
    const noteId = fact(state, "Prices are in cents")?.id;
    state = (await api.delete(`/api/projects/${project.id}/memory/facts/${noteId}`))
      .body as ProjectMemoryDto;
    expect(fact(state, "Prices are in cents")).toBeUndefined();
    expect(
      (await api.patch(`/api/projects/${project.id}/memory/facts/missing`, { pinned: true }))
        .status,
    ).toBe(404);
  });

  it("is frozen in a new session and kept on resume", async () => {
    const fresh = await run("Fresh", "Small change", true);
    const sessionId = fresh.runs[0]?.sessionId ?? "";
    const stored = await context.container.prisma.session.findUnique({ where: { id: sessionId } });
    const frozen = (stored?.memory as { text: string } | null)?.text ?? "";
    expect(frozen).toContain("## Onyx project memory");
    expect(frozen).toContain("Run the tests with `pnpm test`");

    await api.post(`/api/projects/${project.id}/memory/notes`, { text: "Added after the session" });
    const resumed = await run("Resumed", "Another small change");
    expect(resumed.runs[0]?.sessionId).toBe(sessionId);
    const after = await context.container.prisma.session.findUnique({ where: { id: sessionId } });
    expect((after?.memory as { text: string } | null)?.text).toBe(frozen);
  });

  it("measures new sessions with and without memory when the experiment is on", async () => {
    const settings = await api.put<MemorySettings>("/api/settings/memory", {
      enabled: true,
      budgetTokens: 800,
      expiryDays: 30,
      experiment: true,
    });
    expect(settings.status).toBe(200);
    random = 0.2;
    const without = await run("Control", "Small change", true);
    const runRow = await context.container.prisma.agentRun.findUnique({
      where: { id: without.runs[0]?.id ?? "" },
      include: { session: true },
    });
    expect(runRow?.memoryArm).toBe("NO_MEMORY");
    expect(runRow?.session.memory).toBeNull();
    random = 0.9;
    const withMemory = await run("Treated", "Small change", true);
    const treated = await context.container.prisma.agentRun.findUnique({
      where: { id: withMemory.runs[0]?.id ?? "" },
    });
    expect(treated?.memoryArm).toBe("MEMORY");

    context.container.savings.forget();
    const report = (await api.get<SavingsReport>("/api/telemetry/savings")).body;
    expect(report.memory).toMatchObject({ state: "COLLECTING" });
    expect(report.memory.withMemory.runs).toBe(1);
    expect(report.memory.without.runs).toBe(1);
    const row = report.ledger.find((entry) => entry.source === "project-memory");
    expect(row?.evidence).toBe("ESTIMATED");
    expect(row?.detail).toContain("new sessions started with it");
    expect(
      (
        await api.put("/api/settings/memory", {
          enabled: true,
          budgetTokens: 50,
          expiryDays: 30,
          experiment: false,
        })
      ).status,
    ).toBe(400);
  });

  it("remembers the test command of a green TDD loop", async () => {
    await context.container.memory.learnFromLoop({
      projectId: project.id,
      fullCommand: "npx vitest run --reporter=json",
      runId: null,
    });
    const state = await memory();
    expect(fact(state, "npx vitest run --reporter=json")).toMatchObject({
      kind: "TEST",
      status: "ACTIVE",
    });
  });
});
