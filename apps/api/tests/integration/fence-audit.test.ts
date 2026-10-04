import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProjectDetailDto, RunEventsResponse, TaskDetailDto, TaskDto } from "@onyx/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WorkTreeActivity } from "../../src/infrastructure/work-tree-activity";
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
let probeDir: string;

const FILES: Record<string, string> = {
  "apps/web/page.tsx": "export const page = 1;\n",
  "apps/api/server.ts": "export const server = 1;\n",
  "apps/api/routes.ts": "export const routes = 1;\n",
};

function git(args: string[]): string {
  return execFileSync("git", args, { cwd: context.projectRoot, encoding: "utf8" });
}

function file(path: string): string | null {
  const absolute = join(context.projectRoot, path);
  return existsSync(absolute) ? readFileSync(absolute, "utf8") : null;
}

beforeAll(async () => {
  probeDir = mkdtempSync(join(tmpdir(), "onyx-fence-probe-"));
  context = await createTestContext({
    projectFiles: FILES,
    sourceEnv: { CLAUDE_STUB_PROBE: join(probeDir, "probe.json") },
  });
  git(["init", "--quiet", "--initial-branch=main"]);
  git(["-c", "user.email=t@onyx", "-c", "user.name=t", "add", "-A"]);
  git(["-c", "user.email=t@onyx", "-c", "user.name=t", "commit", "--quiet", "-m", "init"]);
  api = apiClient(context.app, await authenticate(context.app));
  project = (
    await api.post<ProjectDetailDto>("/api/projects", {
      name: "fenced",
      rootPath: context.projectRoot,
    })
  ).body;
  await context.container.indexes.idle(project.id);
});

afterAll(async () => {
  await destroyTestContext(context);
  rmSync(probeDir, { recursive: true, force: true });
});

describe("writes outside the workspace that slip past the hook", () => {
  it("are put back when the run ends, and only those (A8)", async () => {
    writeFileSync(join(context.projectRoot, "apps/api/routes.ts"), "export const routes = 2;\n");
    const root = context.projectRoot;
    writeFileSync(
      join(probeDir, "probe.json"),
      JSON.stringify([
        { path: join(root, "apps/web/page.tsx"), action: "write" },
        { path: join(root, "apps/api/server.ts"), action: "write" },
        { path: join(root, "apps/api/routes.ts"), action: "write" },
        { path: join(root, "apps/api/new.ts"), action: "write" },
      ]),
    );
    const frontend = project.workspaces.find((workspace) => workspace.name === "Frontend");
    const task = (
      await api.post<TaskDto>("/api/tasks", {
        projectId: project.id,
        workspaceId: frontend?.id,
        title: "Page",
        prompt: "Change the page [stub:probe]",
        kind: "FEATURE",
      })
    ).body;
    await api.post(`/api/tasks/${task.id}/run`, {});
    const detail = await waitFor(
      async () => (await api.get<TaskDetailDto>(`/api/tasks/${task.id}`)).body,
      (entry) => entry.status === "COMPLETED" || entry.status === "FAILED",
      20_000,
    );
    expect(detail.status).toBe("COMPLETED");

    expect(file("apps/web/page.tsx")).toBe("written by the agent\n");
    expect(file("apps/api/server.ts")).toBe(FILES["apps/api/server.ts"]);
    expect(file("apps/api/routes.ts")).toBe("export const routes = 2;\n");
    expect(file("apps/api/new.ts")).toBeNull();

    const events = (await api.get<RunEventsResponse>(`/api/runs/${detail.runs[0]?.id}/events`))
      .body;
    const undone = events.items
      .flatMap((event) => event.items)
      .find((item) => item.kind === "guard" && item.source === "audit");
    expect(undone).toMatchObject({
      target: "apps/api/new.ts, apps/api/routes.ts, apps/api/server.ts",
      rule: "write fence (Frontend)",
    });
    expect(detail.runs[0]?.guardDenials).toBe(1);
  });
});

describe("workspaces working at the same time", () => {
  it("are not undone by each other", () => {
    let now = 0;
    const activity = new WorkTreeActivity(() => now);
    const frontend = activity.begin("/p", "Frontend");
    now = 10;
    const backend = activity.begin("/p", "Backend");
    now = 20;
    activity.end(backend);
    const elsewhere = activity.begin("/other", "Database");
    now = 30;
    expect([...activity.concurrent(frontend)]).toEqual(["Backend"]);
    const later = activity.begin("/p", "Database");
    expect([...activity.concurrent(later)]).toEqual(["Frontend"]);
    activity.end(frontend);
    activity.end(elsewhere);
  });
});
