import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  ProjectDetailDto,
  SavingsOptionsDto,
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

const FILES: Record<string, string> = {
  "apps/web/page.tsx": "export const page = 1;\n",
  "apps/api/server.ts": "export const server = 1;\n",
};

async function createTask(workspace: string, title: string, prompt: string): Promise<TaskDto> {
  return (
    await api.post<TaskDto>("/api/tasks", {
      projectId: project.id,
      workspaceId: project.workspaces.find((entry) => entry.name === workspace)?.id,
      title,
      prompt,
    })
  ).body;
}

async function settled(id: string): Promise<TaskDetailDto> {
  return waitFor(
    async () => (await api.get<TaskDetailDto>(`/api/tasks/${id}`)).body,
    (detail) => detail.status === "COMPLETED" || detail.status === "FAILED",
    20_000,
  );
}

function primer(runId: string): string {
  const file = join(context.dataDir, "runtime", runId, "primer.md");
  return existsSync(file) ? readFileSync(file, "utf8") : "";
}

beforeAll(async () => {
  context = await createTestContext({ maxConcurrent: 1, projectFiles: FILES });
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

describe("token saving options", () => {
  it("start with short summaries and cheap exploration, without grouping", async () => {
    const options = (await api.get<SavingsOptionsDto>("/api/settings/savings-options")).body;
    expect(options).toMatchObject({
      conciseAnswers: true,
      cheapExploration: true,
      batchSmallTasks: false,
      batchingSince: null,
    });
    expect(options.conciseSince).not.toBeNull();
    expect((await api.put("/api/settings/savings-options", { conciseAnswers: true })).status).toBe(
      400,
    );
  });

  it("asks for short summaries in new sessions and keeps the choice on resume", async () => {
    const first = await createTask("Frontend", "Label", "Rename the label");
    await api.post(`/api/tasks/${first.id}/run`, { newSession: true });
    const fresh = await settled(first.id);
    expect(primer(fresh.runs[0]?.id ?? "")).toContain("## Final message");

    await api.put("/api/settings/savings-options", {
      conciseAnswers: false,
      cheapExploration: true,
      batchSmallTasks: false,
    });
    const second = await createTask("Frontend", "Colour", "Change the colour");
    await api.post(`/api/tasks/${second.id}/run`, {});
    const resumed = await settled(second.id);
    expect(resumed.runs[0]?.sessionId).toBe(fresh.runs[0]?.sessionId);
    expect(primer(resumed.runs[0]?.id ?? "")).toContain("## Final message");

    const third = await createTask("Frontend", "Margin", "Change the margin");
    await api.post(`/api/tasks/${third.id}/run`, { newSession: true });
    const plain = await settled(third.id);
    expect(primer(plain.runs[0]?.id ?? "")).not.toContain("## Final message");
  });

  it("groups small queued tasks of a workspace and settles each one", async () => {
    await api.put("/api/settings/savings-options", {
      conciseAnswers: true,
      cheapExploration: true,
      batchSmallTasks: true,
    });
    const blocker = await createTask("Backend", "Blocker", "Hold the slot [stub:hang]");
    await api.post(`/api/tasks/${blocker.id}/run`, {});
    await waitFor(
      () => Promise.resolve(context.container.scheduler.activeCount),
      (count) => count === 1,
    );
    const done = await createTask("Frontend", "Title", "Fix the title");
    const failing = await createTask("Frontend", "Footer", "Fix the footer [stub:fail-task]");
    const skipped = await createTask("Frontend", "Header", "Fix the header [stub:skip-task]");
    const large = await createTask("Frontend", "Big one", "x".repeat(700));
    for (const task of [done, failing, skipped, large])
      await api.post(`/api/tasks/${task.id}/run`, {});
    await api.post(`/api/tasks/${blocker.id}/cancel`, {});

    const first = await settled(done.id);
    const run = await context.container.prisma.agentRun.findUnique({
      where: { id: first.runs[0]?.id ?? "" },
    });
    expect(run?.batchSize).toBe(3);
    expect(first.status).toBe("COMPLETED");
    const footer = await settled(failing.id);
    expect(footer).toMatchObject({ status: "FAILED" });
    const footerRow = await context.container.prisma.task.findUnique({ where: { id: failing.id } });
    expect(footerRow?.resultSummary).toContain("the stub could not do this one");
    expect(footerRow?.batchRunId).toBe(run?.id);
    const header = await settled(skipped.id);
    expect(header.status).toBe("COMPLETED");
    expect(header.runs).toHaveLength(1);
    expect(header.runs[0]?.id).not.toBe(run?.id);
    const big = await settled(large.id);
    expect(big.runs[0]?.id).not.toBe(run?.id);
    await context.container.scheduler.idle();

    context.container.savings.forget();
    const report = (await api.get<SavingsReport>("/api/telemetry/savings")).body;
    const row = report.ledger.find((entry) => entry.source === "small-task-batching");
    expect(row).toMatchObject({ evidence: "ESTIMATED", runs: 1 });
    expect(report.ledger.find((entry) => entry.source === "concise-answers")?.evidence).toBe(
      "ESTIMATED",
    );
  }, 90_000);
});
