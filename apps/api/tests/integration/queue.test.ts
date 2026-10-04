import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ProjectDetailDto, QueueDto, TaskDto } from "@onyx/contracts";
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
let alpha: ProjectDetailDto;
let beta: ProjectDetailDto;

async function project(name: string, root: string): Promise<ProjectDetailDto> {
  const created = (await api.post<ProjectDetailDto>("/api/projects", { name, rootPath: root }))
    .body;
  await context.container.indexes.idle(created.id);
  return created;
}

async function queuedTask(owner: ProjectDetailDto, workspace: string, title: string) {
  const workspaceId = owner.workspaces.find((entry) => entry.name === workspace)?.id;
  const task = (
    await api.post<TaskDto>("/api/tasks", {
      projectId: owner.id,
      workspaceId,
      title,
      prompt: `${title} [stub:hang]`,
      kind: "FEATURE",
    })
  ).body;
  await api.post(`/api/tasks/${task.id}/run`, {});
  return task;
}

beforeAll(async () => {
  context = await createTestContext({
    maxConcurrent: 2,
    projectFiles: {
      "apps/web/page.tsx": "export const page = 1;\n",
      "apps/api/server.ts": "export const server = 1;\n",
    },
  });
  api = apiClient(context.app, await authenticate(context.app));
  const other = join(context.projectsDir, "other");
  mkdirSync(join(other, "src"), { recursive: true });
  writeFileSync(join(other, "src", "index.ts"), "export const other = 1;\n");
  alpha = await project("alpha", context.projectRoot);
  beta = await project("beta", other);
});

afterAll(async () => {
  await destroyTestContext(context);
});

describe("global queue", () => {
  it("keeps a project within its limit, reorders and lifts the limit", async () => {
    const settings = await api.put<QueueDto>("/api/queue/settings", {
      projectLimit: 1,
      agingMinutes: 0,
    });
    expect(settings.status).toBe(200);
    expect(settings.body.settings).toEqual({ projectLimit: 1, agingMinutes: 0 });
    expect(
      (await api.put("/api/queue/settings", { projectLimit: 0, agingMinutes: 0 })).status,
    ).toBe(400);

    const [frontend, backend] = alpha.workspaces.map((entry) => entry.name);
    expect(frontend && backend).toBeTruthy();
    const first = await queuedTask(alpha, frontend ?? "", "Alpha one");
    const second = await queuedTask(alpha, backend ?? "", "Alpha two");
    const third = await queuedTask(alpha, backend ?? "", "Alpha three");
    const other = await queuedTask(beta, beta.workspaces[0]?.name ?? "", "Beta one");

    const queue = await waitFor(
      async () => (await api.get<QueueDto>("/api/queue")).body,
      (entry) => entry.active.length === 2,
      10_000,
    );
    expect(queue.active.map((run) => run.title).sort()).toEqual(["Alpha one", "Beta one"]);
    expect(queue.items.map((entry) => [entry.title, entry.waiting])).toEqual([
      ["Alpha two", "PROJECT"],
      ["Alpha three", "PROJECT"],
    ]);
    expect(queue.projects.find((entry) => entry.projectName === "alpha")).toMatchObject({
      running: 1,
      queued: 2,
      limit: 1,
      ownLimit: null,
    });

    const moved = await api.post<QueueDto>(`/api/queue/${third.id}/move`, { to: "top" });
    expect(moved.status).toBe(200);
    expect(moved.body.items.map((entry) => entry.title)).toEqual(["Alpha three", "Alpha two"]);
    expect((await api.get<TaskDto>(`/api/tasks/${third.id}`)).body.priority).toBe(0);
    expect((await api.post(`/api/queue/missing/move`, { to: "up" })).status).toBe(404);

    await api.post(`/api/tasks/${other.id}/cancel`, {});
    const limited = await waitFor(
      async () => (await api.get<QueueDto>("/api/queue")).body,
      (entry) => entry.active.length === 1 && entry.items.length === 2,
      10_000,
    );
    expect(limited.items.map((entry) => [entry.title, entry.waiting])).toEqual([
      ["Alpha three", "PROJECT"],
      ["Alpha two", "PROJECT"],
    ]);

    const lifted = await api.put<QueueDto>(`/api/queue/projects/${alpha.id}`, { limit: 2 });
    expect(lifted.body.projects.find((entry) => entry.projectId === alpha.id)).toMatchObject({
      limit: 2,
      ownLimit: 2,
    });
    const running = await waitFor(
      async () => (await api.get<QueueDto>("/api/queue")).body,
      (entry) => entry.active.length === 2,
      10_000,
    );
    expect(running.active.map((run) => run.title).sort()).toEqual(["Alpha one", "Alpha three"]);

    for (const task of [first, second, third]) await api.post(`/api/tasks/${task.id}/cancel`, {});
    await context.container.scheduler.idle();
  });

  it("changes the priority of a queued task", async () => {
    const task = (
      await api.post<TaskDto>("/api/tasks", {
        projectId: beta.id,
        workspaceId: beta.workspaces[0]?.id,
        title: "Later",
        prompt: "Later",
        kind: "FEATURE",
      })
    ).body;
    const updated = await api.patch<TaskDto>(`/api/tasks/${task.id}`, { priority: 7 });
    expect(updated.body.priority).toBe(7);
    expect((await api.patch(`/api/tasks/${task.id}`, {})).status).toBe(400);
  });
});
