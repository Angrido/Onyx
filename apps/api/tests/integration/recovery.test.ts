import { randomUUID } from "node:crypto";
import type { RunEventsResponse, TaskDetailDto } from "@onyx/contracts";
import { createTestDatabase } from "@onyx/db/testing";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  apiClient,
  authenticate,
  createTestContext,
  destroyTestContext,
  waitFor,
  type TestContext,
} from "../helpers";

let context: TestContext | null = null;

afterEach(async () => {
  if (context) await destroyTestContext(context);
  context = null;
});

describe("startup recovery", () => {
  it("marks orphaned runs interrupted and resumes queued tasks", async () => {
    const database = createTestDatabase();
    const dataDir = mkdtempSync(join(tmpdir(), "onyx-recovery-"));

    const first = await createTestContext({ database, dataDir });
    const cookie = await authenticate(first.app);
    const api = apiClient(first.app, cookie);
    const project = (
      await api.post<{ id: string; workspaces: Array<{ id: string }> }>("/api/projects", {
        name: "demo",
        rootPath: first.projectRoot,
      })
    ).body;
    const prisma = first.container.prisma;
    const workspaceId = project.workspaces[0]?.id as string;
    const orphanTask = await prisma.task.create({
      data: {
        projectId: project.id,
        workspaceId,
        title: "orphan",
        prompt: "p",
        kind: "FEATURE",
        status: "RUNNING",
      },
    });
    const session = await prisma.session.create({
      data: { id: randomUUID(), workspaceId, modelId: "claude-sonnet-5-5", status: "ACTIVE" },
    });
    const orphanRun = await prisma.agentRun.create({
      data: {
        taskId: orphanTask.id,
        sessionId: session.id,
        modelId: "claude-sonnet-5-5",
        prompt: "p",
        args: [],
        status: "RUNNING",
        pid: 2 ** 22 + 11,
      },
    });
    const queuedTask = await prisma.task.create({
      data: {
        projectId: project.id,
        workspaceId: project.workspaces[1]?.id as string,
        title: "queued",
        prompt: "Resume me [stub:quick]",
        kind: "FEATURE",
        status: "QUEUED",
      },
    });
    await first.close();

    context = await createTestContext({ database, dataDir });
    const restartedApi = apiClient(context.app, cookie);

    const orphan = (await restartedApi.get<TaskDetailDto>(`/api/tasks/${orphanTask.id}`)).body;
    expect(orphan.status).toBe("INTERRUPTED");
    expect(orphan.runs[0]).toMatchObject({
      status: "INTERRUPTED",
      errorMessage: "Interrupted by Onyx restart",
    });
    const events = await restartedApi.get<RunEventsResponse>(`/api/runs/${orphanRun.id}/events`);
    expect(events.body.items.at(-1)?.items[0]).toMatchObject({
      kind: "status",
      status: "INTERRUPTED",
    });

    const resumed = await waitFor(
      async () => (await restartedApi.get<TaskDetailDto>(`/api/tasks/${queuedTask.id}`)).body,
      (task) => task.status === "COMPLETED",
    );
    expect(resumed.runs).toHaveLength(1);
  });
});
