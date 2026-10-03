import { fileURLToPath } from "node:url";
import type {
  IndexStatusDto,
  ProjectDetailDto,
  ServerMessage,
  SessionListResponse,
  TaskDetailDto,
  TaskDto,
  TerminalDto,
  TerminalListResponse,
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

const STATUSLINE = fileURLToPath(
  new URL("../../../../packages/mcp-server/src/statusline.ts", import.meta.url),
);

const PROJECT_FILES: Record<string, string> = {
  "package.json": JSON.stringify({ name: "shop", type: "module" }),
  "apps/web/src/button.tsx": "export function Button() {\n  return null;\n}\n",
  "apps/api/src/login.ts":
    "export function login(user: string): boolean {\n  return user.length > 0;\n}\n",
};

let context: TestContext;
let api: ApiClient;
let cookie: string;
let project: ProjectDetailDto;

interface Inbox {
  socket: WebSocket;
  messages: ServerMessage[];
}

function workspaceId(name: string): string {
  const workspace = project.workspaces.find((candidate) => candidate.name === name);
  if (!workspace) throw new Error(`Workspace ${name} missing`);
  return workspace.id;
}

async function connect(): Promise<Inbox> {
  const messages: ServerMessage[] = [];
  const socket = await context.app.injectWS("/ws", { headers: { cookie, origin: ORIGIN } });
  socket.on("message", (data) => messages.push(JSON.parse(data.toString()) as ServerMessage));
  return { socket, messages };
}

function send(inbox: Inbox, message: object): void {
  inbox.socket.send(JSON.stringify({ v: 1, ...message }));
}

function screen(inbox: Inbox): string {
  return inbox.messages
    .flatMap((message) => (message.type === "pty.output" ? [message.data.data] : []))
    .join("");
}

async function expectScreen(inbox: Inbox, needle: string, timeoutMs = 15_000): Promise<string> {
  return waitFor(
    () => Promise.resolve(screen(inbox)),
    (text) => text.includes(needle),
    timeoutMs,
  );
}

async function terminal(id: string): Promise<TerminalDto> {
  return (await api.get<TerminalDto>(`/api/terminals/${id}`)).body;
}

async function sessionsOf(name: string) {
  return (await api.get<SessionListResponse>(`/api/workspaces/${workspaceId(name)}/sessions`)).body
    .items;
}

beforeAll(async () => {
  context = await createTestContext({
    projectFiles: PROJECT_FILES,
    env: { ONYX_STATUSLINE: STATUSLINE, ONYX_TERMINAL_IDLE_MS: "200" },
    sourceEnv: { CLAUDE_STUB_TOKENS_PER_MESSAGE: "4000" },
  });
  await context.app.listen({ host: "127.0.0.1", port: 0 });
  const address = context.app.server.address();
  if (address === null || typeof address === "string") throw new Error("API is not listening");
  context.container.config.internalApiUrl = `http://127.0.0.1:${address.port}`;
  cookie = await authenticate(context.app);
  api = apiClient(context.app, cookie);
  project = (
    await api.post<ProjectDetailDto>("/api/projects", {
      name: "shop",
      rootPath: context.projectRoot,
    })
  ).body;
  await waitFor(
    async () => (await api.get<IndexStatusDto>(`/api/projects/${project.id}/index`)).body,
    (status) => status.state === "ready",
    30_000,
  );
  const patched = await api.patch(`/api/workspaces/${workspaceId("Frontend")}`, {
    maxSessionTokens: 10_000,
  });
  expect(patched.status).toBe(200);
}, 120_000);

afterAll(async () => {
  await destroyTestContext(context);
});

describe("interactive terminals", () => {
  it("compacts on context pressure and clears with a handoff after a domain switch", async () => {
    const opened = await api.post<TerminalDto>(
      `/api/workspaces/${workspaceId("Frontend")}/terminal`,
      { cols: 100, rows: 30 },
    );
    expect(opened.status).toBe(201);
    const id = opened.body.id;
    expect(opened.body).toMatchObject({ state: "running", workspaceName: "Frontend" });
    const again = await api.post<TerminalDto>(
      `/api/workspaces/${workspaceId("Frontend")}/terminal`,
      {},
    );
    expect(again.body.id).toBe(id);

    const inbox = await connect();
    send(inbox, { type: "subscribe", data: { channels: [`pty:${id}`] } });
    await expectScreen(inbox, `session ${opened.body.sessionId}`);
    expect(inbox.messages.some((message) => message.type === "pty.state")).toBe(true);
    await waitFor(
      () => terminal(id),
      (dto) => dto.claudeSessionId === opened.body.sessionId,
    );
    await expectScreen(inbox, "[status] Onyx · Frontend · 4k/10k");

    send(inbox, { type: "pty.input", data: { terminalId: id, data: "Tighten the button\r" } });
    await expectScreen(inbox, "Stub reply: Tighten the button");
    await expectScreen(inbox, "Onyx · Frontend · 8k/10k");

    send(inbox, { type: "pty.input", data: { terminalId: id, data: "Add a hover state\r" } });
    await expectScreen(inbox, "[compacted] Keep what matters for the Frontend workspace");
    const compacted = await waitFor(
      () => terminal(id),
      (dto) => dto.lastInjection?.action === "compact" && dto.contextTokens === 4_000,
    );
    expect(compacted.lastInjection).toMatchObject({ reason: "CONTEXT_PRESSURE", handoff: false });
    expect(compacted.sessionId).toBe(opened.body.sessionId);

    const backend = (
      await api.post<TaskDto>("/api/tasks", {
        projectId: project.id,
        workspaceId: workspaceId("Backend"),
        title: "Login endpoint",
        prompt: "[stub:guard] edit:apps/api/src/login.ts",
      })
    ).body;
    expect((await api.post(`/api/tasks/${backend.id}/run`)).status).toBe(202);
    await waitFor(
      async () => (await api.get<TaskDetailDto>(`/api/tasks/${backend.id}`)).body,
      (detail) => detail.status === "COMPLETED",
      30_000,
    );

    const cleared = await expectScreen(inbox, "[context] # Handoff for the Frontend workspace");
    expect(cleared).toContain("[cleared] session");
    const rotated = await waitFor(
      () => terminal(id),
      (dto) => dto.lastInjection?.action === "clear" && dto.sessionId !== opened.body.sessionId,
    );
    expect(rotated.lastInjection).toMatchObject({ reason: "DOMAIN_SWITCH", handoff: true });
    expect(rotated.claudeSessionId).not.toBe(opened.body.sessionId);

    const sessions = await sessionsOf("Frontend");
    const [current, previous] = sessions;
    expect(current).toMatchObject({ id: rotated.sessionId, status: "ACTIVE" });
    expect(current?.previousId).toBe(opened.body.sessionId);
    expect(current?.handoffNote).toContain("## Meanwhile in other workspaces");
    expect(current?.handoffNote).toContain("apps/api/src/login.ts");
    expect(current?.handoffNote).toContain("Requests in the terminal: Tighten the button");
    expect(previous).toMatchObject({ status: "ROTATED", endReason: "DOMAIN_SWITCH" });

    const manual = await api.post<TerminalDto>(`/api/terminals/${id}/inject`, {
      action: "clear",
      handoff: false,
    });
    expect(manual.status).toBe(200);
    const reset = await waitFor(
      () => terminal(id),
      (dto) => dto.lastInjection?.reason === "MANUAL_RESET" && dto.sessionId !== rotated.sessionId,
    );
    expect(reset.pending).toBeNull();
    const afterReset = await sessionsOf("Frontend");
    expect(afterReset[0]?.handoffNote).toBeNull();
    expect(afterReset[1]).toMatchObject({ status: "ROTATED", endReason: "MANUAL_RESET" });

    const queued = (
      await api.post<TaskDto>("/api/tasks", {
        projectId: project.id,
        workspaceId: workspaceId("Frontend"),
        title: "Polish",
        prompt: "[stub:quick] Polish the button",
      })
    ).body;
    expect((await api.post(`/api/tasks/${queued.id}/run`)).status).toBe(202);
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect((await api.get<TaskDetailDto>(`/api/tasks/${queued.id}`)).body.status).toBe("QUEUED");

    const closed = await api.delete(`/api/terminals/${id}`);
    expect(closed.status).toBe(200);
    expect((await terminal(id)).state).toBe("exited");
    await waitFor(
      async () => (await api.get<TaskDetailDto>(`/api/tasks/${queued.id}`)).body,
      (detail) => detail.status === "COMPLETED",
      30_000,
    );
    await context.container.scheduler.idle();
    const resumed = await sessionsOf("Frontend");
    expect(resumed[0]?.id).toBe(reset.sessionId);
    expect(resumed[0]?.runs).toBe(1);

    const listed = await api.get<TerminalListResponse>(
      `/api/terminals?workspaceId=${workspaceId("Frontend")}`,
    );
    expect(listed.body.items.map((item) => item.id)).toEqual([id]);
    inbox.socket.terminate();
  }, 90_000);

  it("rejects input for unknown terminals and refuses busy workspaces", async () => {
    const inbox = await connect();
    send(inbox, { type: "pty.input", data: { terminalId: "missing", data: "x" } });
    await waitFor(
      () => Promise.resolve(inbox.messages),
      (messages) => messages.some((message) => message.type === "error"),
    );
    inbox.socket.terminate();

    const task = (
      await api.post<TaskDto>("/api/tasks", {
        projectId: project.id,
        workspaceId: workspaceId("Backend"),
        title: "Slow",
        prompt: "[stub:hang] wait",
      })
    ).body;
    await api.post(`/api/tasks/${task.id}/run`);
    await waitFor(
      () => Promise.resolve(context.container.scheduler.isWorkspaceBusy(workspaceId("Backend"))),
      (busy) => busy,
    );
    const refused = await api.post(`/api/workspaces/${workspaceId("Backend")}/terminal`, {});
    expect(refused.status).toBe(409);
    expect((await api.post(`/api/tasks/${task.id}/cancel`)).status).toBe(200);
    await context.container.scheduler.idle();
  }, 60_000);
});
