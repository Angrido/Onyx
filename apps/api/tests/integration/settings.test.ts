import type {
  ClaudeAccountDto,
  ClaudeLoginDto,
  ClaudeTestResult,
  ProjectDetailDto,
  ServerMessage,
  TaskDetailDto,
  TaskDto,
} from "@onyx/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { WebSocket } from "ws";
import {
  ORIGIN,
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
let cookie: string;

async function account(): Promise<ClaudeAccountDto> {
  return (await api.get<ClaudeAccountDto>("/api/settings/claude")).body;
}

async function runQuickTask(project: ProjectDetailDto): Promise<TaskDetailDto> {
  const task = (
    await api.post<TaskDto>("/api/tasks", {
      projectId: project.id,
      workspaceId: project.workspaces[0]?.id,
      title: "Ping",
      prompt: "[stub:quick] ping",
    })
  ).body;
  await api.post(`/api/tasks/${task.id}/run`);
  await context.container.scheduler.idle();
  return (await api.get<TaskDetailDto>(`/api/tasks/${task.id}`)).body;
}

beforeAll(async () => {
  context = await createTestContext({ sourceEnv: { CLAUDE_STUB_REQUIRE_AUTH: "1" } });
  cookie = await authenticate(context.app);
  api = apiClient(context.app, cookie);
}, 60_000);

afterAll(async () => {
  await destroyTestContext(context);
});

describe("Claude account settings", () => {
  it("starts without credentials and runs fail until one is connected", async () => {
    expect(await account()).toMatchObject({ configured: false, source: null, login: null });
    const tested = await api.post<ClaudeTestResult>("/api/settings/claude/test");
    expect(tested.body).toMatchObject({ ok: false });
    const rejected = await api.put("/api/settings/claude/token", { token: "not-a-token" });
    expect(rejected.status).toBe(400);

    const project = (
      await api.post<ProjectDetailDto>("/api/projects", {
        name: "demo",
        rootPath: context.projectRoot,
      })
    ).body;
    const failed = await runQuickTask(project);
    expect(failed.status).toBe("FAILED");
    expect(failed.runs[0]?.errorMessage).toBe(
      "Claude Code reported an error: Invalid API key · Please run /login",
    );
  });

  it("signs in with claude setup-token and saves the token", async () => {
    const started = await api.post<ClaudeLoginDto>("/api/settings/claude/login");
    expect(started.status).toBe(201);
    expect(started.body.state).toBe("running");

    const waiting = await waitFor(
      account,
      (value) =>
        value.login?.signInUrl !== null &&
        value.login?.signInUrl !== undefined &&
        (value.login.screen ?? "").includes("Paste code here"),
    );
    const signInUrl = new URL(waiting.login?.signInUrl ?? "");
    expect(signInUrl.searchParams.get("redirect_uri")).toBe(
      "https://platform.claude.com/oauth/code/callback",
    );
    expect(signInUrl.searchParams.get("code_challenge_method")).toBe("S256");
    expect(signInUrl.searchParams.get("state")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(waiting.login?.screen).toContain("Paste code here");
    expect(waiting.login?.error).toBeNull();
    expect(waiting.simulator).toBe(true);

    const submitted = await api.post<ClaudeAccountDto>("/api/settings/claude/login/code", {
      code: `${"A1b2C3d4".repeat(12)}_code-from-the-browser#${"s".repeat(43)}`,
    });
    expect(submitted.status).toBe(200);
    expect(submitted.body.login?.codeSubmittedAt).not.toBeNull();
    const connected = await waitFor(account, (value) => value.configured);
    expect(connected).toMatchObject({
      source: "settings",
      kind: "oauth-token",
      login: { state: "connected" },
    });
    expect(connected.hint).toMatch(/^sk-ant-oat01-.+…/);
    expect(JSON.stringify({ ...connected, login: null })).not.toMatch(/sk-ant-oat01-[0-9a-f]{40,}/);
  });

  it("still accepts keystrokes from the terminal channel", async () => {
    const started = await api.post<ClaudeLoginDto>("/api/settings/claude/login");
    const messages: ServerMessage[] = [];
    const socket: WebSocket = await context.app.injectWS("/ws", {
      headers: { cookie, origin: ORIGIN },
    });
    socket.on("message", (data) => messages.push(JSON.parse(data.toString()) as ServerMessage));
    await waitFor(account, (value) => (value.login?.screen ?? "").includes("Paste code here"));
    socket.send(
      JSON.stringify({
        v: 1,
        type: "pty.input",
        data: { terminalId: started.body.id, data: "typed-code\r" },
      }),
    );
    await waitFor(account, (value) => value.login?.state === "connected");
    socket.terminate();
  });

  it("uses the saved subscription token for tests, runs and readiness", async () => {
    const tested = await api.post<ClaudeTestResult>("/api/settings/claude/test");
    expect(tested.body).toMatchObject({ ok: true, model: "claude-haiku-4-5" });
    expect((await account()).lastTest?.ok).toBe(true);

    const project = (await api.get<{ items: ProjectDetailDto[] }>("/api/projects")).body.items[0];
    if (!project) throw new Error("project missing");
    const detail = (await api.get<ProjectDetailDto>(`/api/projects/${project.id}`)).body;
    const completed = await runQuickTask(detail);
    expect(completed.status).toBe("COMPLETED");

    const ready = await context.app.inject({ method: "GET", url: "/api/ready" });
    const credentials = (
      ready.json() as { checks: Array<{ name: string; detail: string }> }
    ).checks.find((check) => check.name === "credentials");
    expect(credentials?.detail).toBe("oauth-token (settings)");
  });

  it("pastes an API key, disconnects, and offers a new link after an OAuth error", async () => {
    const pasted = await api.put<ClaudeAccountDto>("/api/settings/claude/token", {
      token: "sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789",
    });
    expect(pasted.body).toMatchObject({ kind: "api-key", lastTest: null });
    const removed = await api.delete("/api/settings/claude/token");
    expect(removed.body).toMatchObject({ configured: false });

    const started = await api.post<ClaudeLoginDto>("/api/settings/claude/login");
    const socket: WebSocket = await context.app.injectWS("/ws", {
      headers: { cookie, origin: ORIGIN },
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    const first = await waitFor(account, (value) => Boolean(value.login?.signInUrl));
    socket.send(
      JSON.stringify({
        v: 1,
        type: "pty.input",
        data: { terminalId: started.body.id, data: "bad\r" },
      }),
    );
    const failed = await waitFor(account, (value) => value.login?.error !== null);
    expect(failed.login).toMatchObject({
      state: "running",
      error: "OAuth error: Request failed with status code 400",
    });
    expect(failed.configured).toBe(false);
    const retried = await api.post<ClaudeAccountDto>("/api/settings/claude/login/retry");
    expect(retried.status).toBe(200);
    const fresh = await waitFor(
      account,
      (value) =>
        value.login?.error === null &&
        Boolean(value.login.signInUrl) &&
        value.login.signInUrl !== first.login?.signInUrl,
    );
    expect(fresh.login?.state).toBe("running");
    const cancelled = await api.delete("/api/settings/claude/login");
    expect(cancelled.body).toMatchObject({ login: { state: "cancelled" } });
    socket.terminate();
  });
});

describe("credentials from the environment", () => {
  it("shows them and refuses changes from the UI", async () => {
    const envContext = await createTestContext({
      env: { CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat01-fromtheenvironment0123456789" },
    });
    try {
      const envApi = apiClient(envContext.app, await authenticate(envContext.app));
      const current = await envApi.get<ClaudeAccountDto>("/api/settings/claude");
      expect(current.body).toMatchObject({ configured: true, source: "env", kind: "oauth-token" });
      const refused = await envApi.put("/api/settings/claude/token", {
        token: "sk-ant-oat01-anotheronefromtheui0123456789",
      });
      expect(refused.status).toBe(409);
      expect((await envApi.post("/api/settings/claude/login")).status).toBe(409);
    } finally {
      await destroyTestContext(envContext);
    }
  });
});

describe("Claude Code compatibility", () => {
  it("checks the CLI at startup and reports missing options in Settings and readiness", async () => {
    const checked = await createTestContext({ checkCli: true });
    try {
      const checkedApi = apiClient(checked.app, await authenticate(checked.app));
      const ready = await waitFor(
        async () => (await checkedApi.get<ClaudeAccountDto>("/api/settings/claude")).body,
        (value) => value.compatibility !== null,
        30_000,
      );
      expect(ready.compatibility).toMatchObject({ version: "0.0.0-stub", ok: true });
    } finally {
      await destroyTestContext(checked);
    }

    const older = await createTestContext({
      checkCli: false,
      sourceEnv: { CLAUDE_STUB_UNKNOWN_FLAGS: "--json-schema,--agents" },
    });
    try {
      const olderApi = apiClient(older.app, await authenticate(older.app));
      const before = await olderApi.get<ClaudeAccountDto>("/api/settings/claude");
      expect(before.body.compatibility).toBeNull();
      const rechecked = await olderApi.post<ClaudeAccountDto>("/api/settings/claude/check");
      expect(rechecked.body.compatibility).toMatchObject({
        ok: false,
        missingFlags: ["--json-schema", "--agents"],
      });
      const readiness = await older.app.inject({ method: "GET", url: "/api/ready" });
      const cli = (
        readiness.json() as { checks: Array<{ name: string; ok: boolean; detail: string }> }
      ).checks.find((check) => check.name === "claude-cli");
      expect(cli).toEqual({
        name: "claude-cli",
        ok: false,
        detail: "0.0.0-stub is not compatible: missing --json-schema, --agents",
      });
    } finally {
      await destroyTestContext(older);
    }
  }, 60_000);
});
