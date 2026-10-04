import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { MissionControlDto, ProjectDetailDto, TaskDetailDto, TaskDto } from "@onyx/contracts";
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
let repo: ProjectDetailDto;
let plain: ProjectDetailDto;

function git(args: string[]): string {
  return execFileSync("git", args, { cwd: context.projectRoot, encoding: "utf8" });
}

beforeAll(async () => {
  context = await createTestContext({
    env: { CLAUDE_CODE_OAUTH_TOKEN: "stub-oauth-token" },
    diskSpace: async () => ({ bavail: 900, blocks: 1_000, bsize: 1024 ** 3 }),
  });
  git(["init", "--quiet", "--initial-branch=main"]);
  git(["-c", "user.email=t@onyx", "-c", "user.name=t", "add", "-A"]);
  git(["-c", "user.email=t@onyx", "-c", "user.name=t", "commit", "--quiet", "-m", "init"]);
  api = apiClient(context.app, await authenticate(context.app));
  repo = (
    await api.post<ProjectDetailDto>("/api/projects", {
      name: "repo",
      rootPath: context.projectRoot,
    })
  ).body;
  const folder = join(context.projectsDir, "plain");
  mkdirSync(join(folder, "src"), { recursive: true });
  writeFileSync(join(folder, "src", "index.ts"), "export const plain = 1;\n");
  plain = (await api.post<ProjectDetailDto>("/api/projects", { name: "plain", rootPath: folder }))
    .body;
  await context.container.indexes.idle(repo.id);
  await context.container.indexes.idle(plain.id);
});

afterAll(async () => {
  await destroyTestContext(context);
});

describe("mission control", () => {
  it("sums up every project in one answer", async () => {
    writeFileSync(join(context.projectRoot, "src", "extra.ts"), "export const extra = 1;\n");
    const before = (await api.get<MissionControlDto>("/api/mission-control")).body;
    const first = before.projects.find((project) => project.id === repo.id);
    expect(first?.git).toMatchObject({ isRepo: true, branch: "main", changeCount: 1, error: null });
    expect(first?.health).toBe("OK");
    expect(before.projects.find((project) => project.id === plain.id)).toMatchObject({
      health: "ATTENTION",
      reasons: ["Not a git repository"],
      lastRun: null,
    });

    writeFileSync(join(context.projectRoot, "src", "more.ts"), "export const more = 1;\n");
    const cached = (await api.get<MissionControlDto>("/api/mission-control")).body;
    expect(cached.projects.find((project) => project.id === repo.id)?.git.changeCount).toBe(1);

    const task = (
      await api.post<TaskDto>("/api/tasks", {
        projectId: repo.id,
        workspaceId: repo.workspaces[0]?.id,
        title: "Fix add",
        prompt: "Fix add",
        kind: "BUGFIX",
      })
    ).body;
    await api.post(`/api/tasks/${task.id}/run`, {});
    await waitFor(
      async () => (await api.get<TaskDetailDto>(`/api/tasks/${task.id}`)).body,
      (entry) => entry.status === "COMPLETED" || entry.status === "FAILED",
      20_000,
    );
    await context.container.scheduler.idle();
    const after = await waitFor(
      async () => (await api.get<MissionControlDto>("/api/mission-control")).body,
      (entry) => entry.projects.find((project) => project.id === repo.id)?.git.changeCount === 2,
      5_000,
    );
    const updated = after.projects.find((project) => project.id === repo.id);
    expect(updated?.lastRun).toMatchObject({ taskId: task.id, title: "Fix add" });
    expect(updated?.today.runs).toBe(1);
    expect(updated?.week.runs).toBe(1);
    expect(updated?.today.tokens).toBeGreaterThan(0);
    expect(after.today.runs).toBe(1);
    expect(updated?.running).toBe(0);
    expect(after.maxConcurrent).toBe(2);
  });
});
