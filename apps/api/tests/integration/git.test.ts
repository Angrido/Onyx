import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type {
  GitIdentityDto,
  GitStatusDto,
  ProjectDetailDto,
  PublishResultDto,
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

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "Seed",
  GIT_AUTHOR_EMAIL: "seed@example.com",
  GIT_COMMITTER_NAME: "Seed",
  GIT_COMMITTER_EMAIL: "seed@example.com",
};

let fixtures: string;
let bare: string;
let root: string;
let context: TestContext;
let api: ApiClient;
let project: ProjectDetailDto;

function git(args: string[], cwd = root): string {
  return execFileSync("git", args, { cwd, env: GIT_ENV }).toString().trim();
}

async function status(): Promise<GitStatusDto> {
  return (await api.get<GitStatusDto>(`/api/projects/${project.id}/git`)).body;
}

async function runTask(prompt: string): Promise<TaskDetailDto> {
  const task = (
    await api.post<TaskDto>("/api/tasks", {
      projectId: project.id,
      workspaceId: project.workspaces.find((workspace) => workspace.name === "Frontend")?.id,
      title: "Polish the button",
      prompt,
    })
  ).body;
  await api.post(`/api/tasks/${task.id}/run`);
  return waitFor(
    async () => (await api.get<TaskDetailDto>(`/api/tasks/${task.id}`)).body,
    (detail) => detail.status === "COMPLETED" || detail.status === "FAILED",
    30_000,
  );
}

beforeAll(async () => {
  fixtures = mkdtempSync(join(tmpdir(), "onyx-git-"));
  const seed = join(fixtures, "seed");
  for (const [path, content] of Object.entries({
    "package.json": JSON.stringify({ name: "shop" }),
    "apps/web/src/button.tsx": "export function Button() {\n  return null;\n}\n",
  })) {
    mkdirSync(dirname(join(seed, path)), { recursive: true });
    writeFileSync(join(seed, path), content);
  }
  git(["init", "-q", "-b", "main"], seed);
  git(["add", "."], seed);
  git(["commit", "-q", "-m", "initial"], seed);
  bare = join(fixtures, "shop.git");
  git(["clone", "-q", "--bare", seed, bare], fixtures);

  context = await createTestContext({ sourceEnv: { CLAUDE_STUB_APPLY_EDITS: "1" } });
  root = join(context.projectsDir, "shop");
  git(["clone", "-q", bare, root], context.projectsDir);
  api = apiClient(context.app, await authenticate(context.app));
  project = (await api.post<ProjectDetailDto>("/api/projects", { name: "shop", rootPath: root }))
    .body;
}, 60_000);

afterAll(async () => {
  await destroyTestContext(context);
  rmSync(fixtures, { recursive: true, force: true });
});

describe("publishing agent changes", () => {
  it("sees the changes an agent made on the default branch", async () => {
    expect(await status()).toMatchObject({
      isRepo: true,
      branch: "main",
      onDefaultBranch: true,
      upstream: "origin/main",
      changeCount: 0,
      unpublishedTasks: [],
    });
    const task = await runTask(
      "[stub:guard] edit:apps/web/src/button.tsx write:apps/web/src/badge.tsx",
    );
    expect(task.status).toBe("COMPLETED");
    const current = await status();
    expect(current.changes).toEqual([
      { path: "apps/web/src/button.tsx", kind: "modified" },
      { path: "apps/web/src/badge.tsx", kind: "untracked" },
    ]);
    expect(current.unpublishedTasks.map((entry) => entry.title)).toEqual(["Polish the button"]);
    expect(current.suggestedBranch).toMatch(/^onyx\/\d{8}-polish-the-button$/);
    expect(current.suggestedMessage).toBe("Onyx: Polish the button");
  });

  it("commits on a new branch with the configured identity and pushes it", async () => {
    const identity = await api.put<GitIdentityDto>("/api/settings/git", {
      name: "Lucio Example",
      email: "lucio@example.com",
    });
    expect(identity.body).toMatchObject({ effectiveName: "Lucio Example" });
    expect(
      (await api.post(`/api/projects/${project.id}/git/publish`, { branch: "main", message: "x" }))
        .status,
    ).toBe(400);

    const branch = (await status()).suggestedBranch;
    const published = await api.post<PublishResultDto>(`/api/projects/${project.id}/git/publish`, {
      branch,
      message: "Onyx: Polish the button",
    });
    expect(published.status).toBe(200);
    expect(published.body).toMatchObject({
      branch,
      pushed: true,
      pushError: null,
      publishedTasks: 1,
      status: { branch, onDefaultBranch: false, changeCount: 0, upstream: `origin/${branch}` },
    });
    expect(published.body.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(git(["log", "-1", "--format=%an <%ae>|%s", branch], bare)).toBe(
      "Lucio Example <lucio@example.com>|Onyx: Polish the button",
    );
    expect(git(["rev-parse", "main"], bare)).toBe(git(["rev-parse", "origin/main"]));
    const tasks = (await api.get<{ items: TaskDto[] }>(`/api/tasks?projectId=${project.id}`)).body;
    expect(tasks.items[0]?.branchName).toBe(branch);

    const again = await api.post(`/api/projects/${project.id}/git/publish`, {
      branch,
      message: "again",
    });
    expect(again.status).toBe(400);
  });

  it("switches back to the default branch", async () => {
    const switched = await api.post<GitStatusDto>(`/api/projects/${project.id}/git/switch-default`);
    expect(switched.body).toMatchObject({ branch: "main", onDefaultBranch: true, changeCount: 0 });
    expect(existsSync(join(root, "apps/web/src/badge.tsx"))).toBe(false);
  });

  it("keeps the commit and reports when the push fails", async () => {
    writeFileSync(join(root, "notes.md"), "# Notes\n");
    git(["remote", "set-url", "origin", join(fixtures, "missing.git")]);
    const published = await api.post<PublishResultDto>(`/api/projects/${project.id}/git/publish`, {
      branch: "onyx/offline",
      message: "Add notes",
    });
    expect(published.body).toMatchObject({ branch: "onyx/offline", pushed: false });
    expect(published.body.pushError).toBeTruthy();
    expect(git(["log", "-1", "--format=%s"])).toBe("Add notes");
    git(["remote", "set-url", "origin", bare]);
  });

  it("refuses to publish while an agent works on the project", async () => {
    const task = (
      await api.post<TaskDto>("/api/tasks", {
        projectId: project.id,
        workspaceId: project.workspaces[0]?.id,
        title: "Long",
        prompt: "[stub:hang] wait",
      })
    ).body;
    await api.post(`/api/tasks/${task.id}/run`);
    await waitFor(status, (value) => value.busy);
    const refused = await api.post(`/api/projects/${project.id}/git/publish`, {
      branch: "onyx/busy",
      message: "x",
    });
    expect(refused.status).toBe(409);
    await api.post(`/api/tasks/${task.id}/cancel`);
    await context.container.scheduler.idle();
  });
});
