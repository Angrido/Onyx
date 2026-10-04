import type {
  DiagnosticsBundle,
  LogListResponse,
  ProjectDetailDto,
  ProjectHealthReport,
} from "@onyx/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  apiClient,
  authenticate,
  createTestContext,
  destroyTestContext,
  ORIGIN,
  type ApiClient,
  type TestContext,
} from "../helpers";

const FAKE = {
  oauth: "sk-ant-oat01-INTEGRATIONfakeToken0123456789abcdefghij",
  github: "ghp_INTEGRATIONfakeGitHub0123456789abcdef",
  secretKey: "b255eC1pbnRlZ3JhdGlvbi1mYWtlLXNlY3JldC1rISE=",
};

let context: TestContext;
let api: ApiClient;
let cookie: string;
let project: ProjectDetailDto;

beforeAll(async () => {
  context = await createTestContext({
    env: {
      CLAUDE_CODE_OAUTH_TOKEN: FAKE.oauth,
      ONYX_GITHUB_TOKEN: FAKE.github,
      ONYX_SECRET_KEY: FAKE.secretKey,
    },
    diskSpace: async () => ({ bavail: 600, blocks: 1_000, bsize: 1024 ** 3 }),
  });
  cookie = await authenticate(context.app);
  api = apiClient(context.app, cookie);
  project = (
    await api.post<ProjectDetailDto>("/api/projects", {
      name: "demo",
      rootPath: context.projectRoot,
    })
  ).body;
  await context.container.indexes.idle(project.id);
  const logs = context.container.logs;
  logs.record({ level: 30, time: Date.now(), msg: "Run started", runId: "run-a" });
  logs.record({ level: 40, time: Date.now(), msg: "Slow push", runId: "run-a" });
  logs.record({
    level: 50,
    time: Date.now(),
    msg: `Push failed with ${FAKE.github}`,
    runId: "run-b",
    headers: { authorization: `Bearer ${FAKE.oauth}` },
  });
});

afterAll(async () => {
  await destroyTestContext(context);
});

describe("system endpoints need the console session", () => {
  it.each([
    "/api/logs",
    "/api/diagnostics",
    "/api/diagnostics/download",
    "/api/projects/whatever/health",
  ])("refuses %s without a session", async (url) => {
    const response = await context.app.inject({ method: "GET", url, headers: { origin: ORIGIN } });
    expect(response.statusCode).toBe(401);
    expect(response.body).not.toContain(FAKE.github);
  });
});

describe("project health", () => {
  it("returns every check with an overall level", async () => {
    const { status, body } = await api.get<ProjectHealthReport>(
      `/api/projects/${project.id}/health`,
    );
    expect(status).toBe(200);
    expect(body.projectId).toBe(project.id);
    expect(body.checks.map((check) => check.id)).toEqual([
      "index",
      "git",
      "tests",
      "disk",
      "credentials",
    ]);
    expect(body.checks.find((check) => check.id === "credentials")).toMatchObject({
      level: "OK",
      reason: "Claude account connected",
    });
    expect(body.checks.find((check) => check.id === "git")?.level).toBe("ATTENTION");
    expect(body.health).toBe("ATTENTION");
  });

  it("answers in the language of the console", async () => {
    const response = await context.app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/health`,
      headers: { origin: ORIGIN, cookie: `${cookie}; onyx_locale=it` },
    });
    const body = response.json<ProjectHealthReport>();
    expect(body.checks.find((check) => check.id === "git")?.reason).toBe("Non è un repository git");
  });

  it("returns 404 for an unknown project", async () => {
    expect((await api.get("/api/projects/missing/health")).status).toBe(404);
  });

  it("shows the checks on the mission control card", async () => {
    const { body } = await api.get<{ projects: { id: string; checks: { id: string }[] }[] }>(
      "/api/mission-control",
    );
    expect(body.projects.find((entry) => entry.id === project.id)?.checks).toHaveLength(5);
  });
});

describe("logs", () => {
  it("filters by level, run, text and limit", async () => {
    const warn = await api.get<LogListResponse>("/api/logs?level=warn");
    expect(warn.status).toBe(200);
    expect(warn.body.entries.map((entry) => entry.msg)).toEqual([
      "Push failed with [redacted]",
      "Slow push",
    ]);
    const run = await api.get<LogListResponse>("/api/logs?runId=run-a");
    expect(run.body.entries.map((entry) => entry.msg)).toEqual(["Slow push", "Run started"]);
    const search = await api.get<LogListResponse>("/api/logs?q=slow");
    expect(search.body.entries.map((entry) => entry.msg)).toEqual(["Slow push"]);
    const limited = await api.get<LogListResponse>("/api/logs?limit=1");
    expect(limited.body.entries).toHaveLength(1);
    expect(limited.body.runIds).toEqual(expect.arrayContaining(["run-a", "run-b"]));
    expect(JSON.stringify(warn.body)).not.toContain(FAKE.github);
    expect(JSON.stringify(warn.body)).not.toContain(FAKE.oauth);
  });

  it("rejects a bad filter", async () => {
    expect((await api.get("/api/logs?level=loud")).status).toBe(400);
    expect((await api.get("/api/logs?limit=0")).status).toBe(400);
  });
});

describe("diagnostics", () => {
  it("previews the bundle without secrets", async () => {
    const { status, body } = await api.get<DiagnosticsBundle>("/api/diagnostics");
    expect(status).toBe(200);
    const text = JSON.stringify(body);
    for (const secret of Object.values(FAKE)) expect(text).not.toContain(secret);
    expect(body.secrets).toMatchObject({
      CLAUDE_CODE_OAUTH_TOKEN: "set",
      ANTHROPIC_API_KEY: "not set",
      ONYX_GITHUB_TOKEN: "set",
      ONYX_SECRET_KEY: "set",
    });
    expect(body.readiness.checks.map((check) => check.name)).toContain("database");
    expect(body.database.tables.find((row) => row.table === "Project")?.rows).toBe(1);
    expect(body.recovery).toMatchObject({ interruptedRuns: 0 });
    expect(body.logs.recent.map((entry) => entry.msg)).toContain("Push failed with [redacted]");
  });

  it("downloads the same bundle as a JSON file", async () => {
    const response = await context.app.inject({
      method: "GET",
      url: "/api/diagnostics/download",
      headers: { origin: ORIGIN, cookie },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("application/json");
    expect(response.headers["content-disposition"]).toMatch(
      /^attachment; filename="onyx-diagnostics-\d{8}-\d{6}\.json"$/,
    );
    expect(response.headers["cache-control"]).toBe("no-store");
    const bundle = response.json<DiagnosticsBundle>();
    expect(bundle.format).toBe(1);
    for (const secret of Object.values(FAKE)) expect(response.body).not.toContain(secret);
  });
});
