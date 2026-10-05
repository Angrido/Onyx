import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  ProjectDetailDto,
  QuotaDto,
  SavingsReport,
  RunEventsResponse,
  TaskDetailDto,
  TaskDto,
} from "@onyx/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { QUOTA_SETTINGS_KEY } from "../../src/application/quota-service";
import {
  apiClient,
  authenticate,
  createTestContext,
  destroyTestContext,
  waitFor,
  type ApiClient,
  type TestContext,
} from "../helpers";

let limitFile: string;
let context: TestContext;
let api: ApiClient;
let project: ProjectDetailDto;

function reportLimit(spec: string): void {
  writeFileSync(limitFile, spec);
}

async function createTask(title: string, canWait: boolean): Promise<TaskDto> {
  return (
    await api.post<TaskDto>("/api/tasks", {
      projectId: project.id,
      workspaceId: project.workspaces[0]?.id,
      title,
      prompt: `${title} [stub:quick]`,
      kind: "CHORE",
      canWait,
    })
  ).body;
}

async function status(taskId: string): Promise<string> {
  return (await api.get<TaskDetailDto>(`/api/tasks/${taskId}`)).body.status;
}

async function completes(taskId: string): Promise<TaskDetailDto> {
  const detail = await waitFor(
    async () => (await api.get<TaskDetailDto>(`/api/tasks/${taskId}`)).body,
    (entry) => entry.status === "COMPLETED",
    20_000,
  );
  await context.container.scheduler.settledTask(taskId);
  return detail;
}

async function quota(): Promise<QuotaDto> {
  await context.container.quota.idle();
  return (await api.get<QuotaDto>("/api/quota")).body;
}

async function staysQueued(taskId: string): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 400));
  expect(await status(taskId)).toBe("QUEUED");
  expect(context.container.scheduler.activeCount).toBe(0);
}

beforeAll(async () => {
  limitFile = join(mkdtempSync(join(tmpdir(), "onyx-quota-")), "limit");
  reportLimit("allowed:0.2:five_hour:3600");
  context = await createTestContext({
    sourceEnv: { CLAUDE_STUB_RATE_LIMIT: `@${limitFile}` },
  });
  api = apiClient(context.app, await authenticate(context.app));
  project = (
    await api.post<ProjectDetailDto>("/api/projects", {
      name: "quota-demo",
      rootPath: context.projectRoot,
    })
  ).body;
  await context.container.indexes.idle(project.id);
});

afterAll(async () => {
  await destroyTestContext(context);
});

describe("Claude subscription quota", () => {
  it("reads the limits Claude reports during a run", async () => {
    expect((await quota()).level).toBe("UNKNOWN");
    reportLimit("allowed_warning:0.8:five_hour:3600");
    const task = await createTask("Warm up", false);
    await api.post(`/api/tasks/${task.id}/run`, {});
    const detail = await completes(task.id);
    const report = await quota();
    expect(report).toMatchObject({
      level: "WARNING",
      windows: [{ type: "five_hour", status: "allowed_warning", utilization: 0.8, stale: false }],
      nextResetAt: null,
    });
    const events = (await api.get<RunEventsResponse>(`/api/runs/${detail.runs[0]?.id}/events`))
      .body;
    expect(
      events.items.flatMap((event) => event.items).some((item) => item.kind === "rate_limit"),
    ).toBe(true);
  });

  it("holds the tasks that can wait near the limit and lets urgent ones through", async () => {
    reportLimit("allowed_warning:0.93:five_hour:3600");
    const urgent = await createTask("Urgent fix", false);
    await api.post(`/api/tasks/${urgent.id}/run`, {});
    await completes(urgent.id);
    expect((await quota()).level).toBe("HOLDING");

    const later = await createTask("Tidy the docs", true);
    expect(later.canWait).toBe(true);
    await api.post(`/api/tasks/${later.id}/run`, {});
    await staysQueued(later.id);
    const held = await quota();
    expect(held.deferredTasks).toBe(1);
    expect(held.nextResetAt).not.toBeNull();
    expect(held.message).toContain("1 task that can wait is held");

    const patched = await api.patch<TaskDto>(`/api/tasks/${later.id}`, { canWait: false });
    expect(patched.body.canWait).toBe(false);
    await completes(later.id);
  });

  it("stops holding when the operator turns deferral off", async () => {
    const later = await createTask("Rename helpers", true);
    await api.post(`/api/tasks/${later.id}/run`, {});
    await staysQueued(later.id);
    const updated = await api.put<QuotaDto>("/api/quota/settings", {
      warnAt: 0.8,
      holdAt: 0.9,
      deferEnabled: false,
    });
    expect(updated.body.settings.deferEnabled).toBe(false);
    await completes(later.id);
    const stored = await context.container.prisma.appSetting.findUnique({
      where: { key: QUOTA_SETTINGS_KEY },
    });
    expect(stored?.value).toEqual({ warnAt: 0.8, holdAt: 0.9, deferEnabled: false });
    const invalid = await api.put("/api/quota/settings", {
      warnAt: 0.9,
      holdAt: 0.8,
      deferEnabled: true,
    });
    expect(invalid.status).toBe(400);
    await api.put("/api/quota/settings", { warnAt: 0.8, holdAt: 0.9, deferEnabled: true });
  });

  it("holds every run at the limit until the operator resumes", async () => {
    reportLimit("rejected::five_hour:3600");
    const first = await createTask("Hit the limit", false);
    await api.post(`/api/tasks/${first.id}/run`, {});
    await completes(first.id);
    expect((await quota()).level).toBe("LIMITED");

    reportLimit("allowed:0.1:five_hour:3600");
    const next = await createTask("Blocked by the limit", false);
    await api.post(`/api/tasks/${next.id}/run`, {});
    await staysQueued(next.id);
    const resumed = await api.post<QuotaDto>("/api/quota/resume", {});
    expect(resumed.body.level).toBe("UNKNOWN");
    await completes(next.id);
    expect((await quota()).level).toBe("OK");
  });

  it("starts held tasks by itself when the window resets", async () => {
    reportLimit("allowed_warning:0.95:five_hour:3");
    const trigger = await createTask("Near the limit", false);
    await api.post(`/api/tasks/${trigger.id}/run`, {});
    await completes(trigger.id);
    reportLimit("allowed:0.1:five_hour:3600");
    const later = await createTask("Can wait a little", true);
    await api.post(`/api/tasks/${later.id}/run`, {});
    await staysQueued(later.id);
    await completes(later.id);
    expect((await quota()).level).toBe("OK");
  });

  it("reports the held runs and the runs that hit the limit in Savings", async () => {
    const runs = await context.container.prisma.agentRun.findMany({
      select: { quotaDeferred: true, quotaLimited: true, task: { select: { title: true } } },
    });
    const flagged = (key: "quotaDeferred" | "quotaLimited") =>
      runs
        .filter((run) => run[key])
        .map((run) => run.task.title)
        .sort();
    expect(flagged("quotaDeferred")).toEqual([
      "Blocked by the limit",
      "Can wait a little",
      "Rename helpers",
      "Tidy the docs",
    ]);
    expect(flagged("quotaLimited")).toEqual(["Hit the limit"]);
    const report = (await api.get<SavingsReport>("/api/telemetry/savings")).body;
    expect(report.ledger.find((row) => row.source === "quota")).toMatchObject({
      evidence: "MEASURED",
      tokens: null,
      runs: 4,
    });
    expect(report.ledger.find((row) => row.source === "stack-commands")).toMatchObject({
      evidence: "ESTIMATED",
      runs: 0,
    });
  });
});
