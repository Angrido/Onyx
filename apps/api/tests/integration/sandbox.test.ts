import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  ProjectDetailDto,
  ReadyResponse,
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

const AGENT_USER = process.env.ONYX_TEST_AGENT_USER;

interface ProbeReport {
  uid: number;
  home: string;
  results: { path: string; action: string; ok: boolean; code: string | null }[];
}

let context: TestContext;
let api: ApiClient;
let project: ProjectDetailDto;
let probeDir: string;

function git(args: string[]): string {
  return execFileSync("git", args, { cwd: context.projectRoot, encoding: "utf8" });
}

beforeAll(async () => {
  if (!AGENT_USER) return;
  probeDir = mkdtempSync(join(tmpdir(), "onyx-probe-"));
  chmodSync(probeDir, 0o755);
  context = await createTestContext({
    env: {
      ONYX_AGENT_USER: AGENT_USER,
      ...(process.env.ONYX_TEST_AGENT_HOME
        ? { ONYX_AGENT_HOME: process.env.ONYX_TEST_AGENT_HOME }
        : {}),
      ONYX_AGENT_GROUP: process.env.ONYX_TEST_AGENT_GROUP ?? "onyx-work",
    },
    sourceEnv: { CLAUDE_STUB_PROBE: join(probeDir, "probe.json") },
  });
  git(["init", "--quiet", "--initial-branch=main"]);
  git(["-c", "user.email=t@onyx", "-c", "user.name=t", "add", "-A"]);
  git(["-c", "user.email=t@onyx", "-c", "user.name=t", "commit", "--quiet", "-m", "init"]);
  api = apiClient(context.app, await authenticate(context.app));
  project = (
    await api.post<ProjectDetailDto>("/api/projects", {
      name: "sandboxed",
      rootPath: context.projectRoot,
    })
  ).body;
  await context.container.indexes.idle(project.id);
});

afterAll(async () => {
  if (!AGENT_USER) return;
  await destroyTestContext(context);
  rmSync(probeDir, { recursive: true, force: true });
});

describe.runIf(AGENT_USER)("agents in their own system user", () => {
  it("reports the sandbox as ready", async () => {
    const ready = (await api.get<ReadyResponse>("/api/ready")).body;
    expect(ready.checks.find((check) => check.name === "agent-sandbox")).toMatchObject({
      ok: true,
      detail: `agents run as ${AGENT_USER}`,
    });
    expect(statSync(context.dataDir).mode & 0o777).toBe(0o710);
  });

  it("keeps Onyx's secrets out of reach while the project stays writable", async () => {
    const config = context.container.config;
    const steps = [
      { path: config.secrets.keyFile, action: "read" },
      { path: config.databaseUrl.replace(/^file:/, ""), action: "read" },
      { path: context.dataDir, action: "list" },
      { path: `/proc/${process.pid}/environ`, action: "read" },
      { path: join(context.projectRoot, ".git", "config"), action: "write" },
      { path: join(context.projectRoot, "src", "math.ts"), action: "write" },
      { path: join(context.projectRoot, "src", "added.ts"), action: "write" },
    ];
    writeFileSync(join(probeDir, "probe.json"), JSON.stringify(steps));
    chmodSync(join(probeDir, "probe.json"), 0o644);
    const task = (
      await api.post<TaskDto>("/api/tasks", {
        projectId: project.id,
        workspaceId: project.workspaces[0]?.id,
        title: "Probe",
        prompt: "Look around [stub:probe]",
        kind: "CHORE",
      })
    ).body;
    await api.post(`/api/tasks/${task.id}/run`, {});
    const detail = await waitFor(
      async () => (await api.get<TaskDetailDto>(`/api/tasks/${task.id}`)).body,
      (entry) => entry.status === "COMPLETED" || entry.status === "FAILED",
      30_000,
    );
    expect(detail.status).toBe("COMPLETED");
    const events = (await api.get<RunEventsResponse>(`/api/runs/${detail.runs[0]?.id}/events`))
      .body;
    const result = events.items
      .flatMap((event) => event.items)
      .find((item) => item.kind === "result");
    const report = JSON.parse(
      result?.kind === "result" ? (result.resultText ?? "{}") : "{}",
    ) as ProbeReport;
    expect(report.uid).not.toBe(process.getuid?.());
    expect(report.results.map((entry) => [entry.action, entry.ok])).toEqual([
      ["read", false],
      ["read", false],
      ["list", false],
      ["read", false],
      ["write", false],
      ["write", true],
      ["write", true],
    ]);
  });

  it("lets Onyx commit what the agent wrote", () => {
    expect(statSync(join(context.projectRoot, "src", "added.ts")).mode & 0o060).toBe(0o060);
    git(["-c", "user.email=t@onyx", "-c", "user.name=t", "add", "-A"]);
    git(["-c", "user.email=t@onyx", "-c", "user.name=t", "commit", "--quiet", "-m", "agent"]);
    expect(git(["status", "--porcelain"]).trim()).toBe("");
    rmSync(join(context.projectRoot, "src", "added.ts"));
  });
});
