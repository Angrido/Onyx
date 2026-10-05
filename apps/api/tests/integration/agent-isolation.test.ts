import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  GitStatusDto,
  ProjectDetailDto,
  PublishResultDto,
  RunEventsResponse,
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
let root: string;
let markers: string;
let context: TestContext;
let api: ApiClient;
let project: ProjectDetailDto;

function git(args: string[], cwd = root): string {
  return execFileSync("git", args, { cwd, env: GIT_ENV }).toString().trim();
}

function plantHooks(): void {
  git(["config", "core.fsmonitor", `touch ${join(markers, "fsmonitor")}; false`]);
  const hook = join(root, ".git", "hooks", "pre-commit");
  writeFileSync(hook, `#!/bin/sh\ntouch ${join(markers, "pre-commit")}\n`);
  chmodSync(hook, 0o755);
}

async function runTask(prompt: string): Promise<TaskDetailDto> {
  const task = (
    await api.post<TaskDto>("/api/tasks", {
      projectId: project.id,
      workspaceId: project.workspaces.find((workspace) => workspace.name === "Frontend")?.id,
      title: "Probe",
      prompt,
    })
  ).body;
  await api.post(`/api/tasks/${task.id}/run`);
  const detail = await waitFor(
    async () => (await api.get<TaskDetailDto>(`/api/tasks/${task.id}`)).body,
    (entry) => entry.status === "COMPLETED" || entry.status === "FAILED",
    30_000,
  );
  await context.container.scheduler.settledTask(task.id);
  return detail;
}

async function guardTargets(runId: string): Promise<string[]> {
  const events = (await api.get<RunEventsResponse>(`/api/runs/${runId}/events`)).body;
  return events.items.flatMap((event) =>
    event.items.flatMap((item) =>
      item.kind === "guard" && item.source === "hook" && item.target ? [item.target] : [],
    ),
  );
}

beforeAll(async () => {
  fixtures = mkdtempSync(join(tmpdir(), "onyx-isolation-"));
  markers = join(fixtures, "markers");
  mkdirSync(markers);
  const bare = join(fixtures, "shop.git");
  git(["init", "-q", "--bare", "-b", "main", bare], fixtures);

  context = await createTestContext({ sourceEnv: { CLAUDE_STUB_APPLY_EDITS: "1" } });
  await context.app.listen({ host: "127.0.0.1", port: 0 });
  const address = context.app.server.address();
  if (address === null || typeof address === "string") throw new Error("API is not listening");
  context.container.config.internalApiUrl = `http://127.0.0.1:${address.port}`;
  root = join(context.projectsDir, "shop");
  mkdirSync(join(root, "apps", "web"), { recursive: true });
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "shop" }));
  writeFileSync(join(root, "apps", "web", "page.ts"), "export const page = 1;\n");
  git(["init", "-q", "-b", "main"]);
  git(["add", "."]);
  git(["commit", "-q", "-m", "initial"]);
  git(["remote", "add", "origin", bare]);
  git(["push", "-q", "-u", "origin", "main"]);
  plantHooks();
  api = apiClient(context.app, await authenticate(context.app));
  project = (await api.post<ProjectDetailDto>("/api/projects", { name: "shop", rootPath: root }))
    .body;
}, 60_000);

afterAll(async () => {
  await destroyTestContext(context);
  rmSync(fixtures, { recursive: true, force: true });
});

describe("git commands run by Onyx", () => {
  it("ignore the fsmonitor and hooks planted in the repository", async () => {
    writeFileSync(join(root, "apps", "web", "page.ts"), "export const page = 2;\n");
    const status = (await api.get<GitStatusDto>(`/api/projects/${project.id}/git`)).body;
    expect(status.changes).toEqual([{ path: "apps/web/page.ts", kind: "modified" }]);
    expect(existsSync(join(markers, "fsmonitor"))).toBe(false);

    const published = await api.post<PublishResultDto>(`/api/projects/${project.id}/git/publish`, {
      branch: "onyx/probe",
      message: "Onyx: probe",
    });
    expect(published.status).toBe(200);
    expect(published.body.pushed).toBe(true);
    expect(git(["log", "-1", "--format=%s", "onyx/probe"])).toBe("Onyx: probe");
    expect(existsSync(join(markers, "pre-commit"))).toBe(false);
    expect(existsSync(join(markers, "fsmonitor"))).toBe(false);
  });
});

describe("agents and Onyx's own files", () => {
  it("cannot write git metadata or read Onyx's keys, database and run files", async () => {
    const keyFile = context.container.config.secrets.keyFile;
    const runtime = context.container.config.runtimeDir;
    const before = git(["config", "--get", "core.fsmonitor"]);
    const task = await runTask(
      `[stub:guard] write:.git/config bash:{echo x >> .git/hooks/post-merge} read:${keyFile} bash:{cat ${keyFile}} bash:{ls ${runtime}/*} read:apps/web/page.ts`,
    );
    expect(task.status).toBe("COMPLETED");
    const run = task.runs[0];
    expect(run).toBeDefined();
    const targets = await guardTargets(run?.id ?? "");
    expect(targets).toEqual([
      ".git/config",
      ".git/hooks/post-merge",
      keyFile,
      keyFile,
      `${runtime}/`,
    ]);
    expect(git(["config", "--get", "core.fsmonitor"])).toBe(before);
    expect(existsSync(join(root, ".git", "hooks", "post-merge"))).toBe(false);
  });
});
