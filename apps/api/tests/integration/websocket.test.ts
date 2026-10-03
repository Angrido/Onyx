import type { ProjectDetailDto, ServerMessage, TaskDetailDto, TaskDto } from "@onyx/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
let project: ProjectDetailDto;

interface Inbox {
  socket: WebSocket;
  messages: ServerMessage[];
}

async function connect(
  headers: Record<string, string> = { cookie, origin: ORIGIN },
): Promise<Inbox> {
  const messages: ServerMessage[] = [];
  const socket = await context.app.injectWS("/ws", { headers });
  socket.on("message", (data) => messages.push(JSON.parse(data.toString()) as ServerMessage));
  return { socket, messages };
}

function send(inbox: Inbox, message: object): void {
  inbox.socket.send(JSON.stringify({ v: 1, ...message }));
}

async function runToCompletion(prompt: string): Promise<TaskDetailDto> {
  const task = (
    await api.post<TaskDto>("/api/tasks", {
      projectId: project.id,
      workspaceId: project.workspaces[0]?.id,
      title: "ws",
      prompt,
    })
  ).body;
  await api.post(`/api/tasks/${task.id}/run`);
  const detail = await waitFor(
    async () => (await api.get<TaskDetailDto>(`/api/tasks/${task.id}`)).body,
    (value) => value.status === "COMPLETED",
  );
  await context.container.scheduler.settledTask(task.id);
  return detail;
}

beforeEach(async () => {
  context = await createTestContext();
  cookie = await authenticate(context.app);
  api = apiClient(context.app, cookie);
  project = (
    await api.post<ProjectDetailDto>("/api/projects", {
      name: "demo",
      rootPath: context.projectRoot,
    })
  ).body;
});

afterEach(async () => {
  await destroyTestContext(context);
});

describe("websocket", () => {
  it("refuses unauthenticated and cross-origin upgrades", async () => {
    await expect(context.app.injectWS("/ws", { headers: { origin: ORIGIN } })).rejects.toThrow();
    await expect(
      context.app.injectWS("/ws", { headers: { cookie, origin: "http://evil.example" } }),
    ).rejects.toThrow();
  });

  it("replays a finished run from the database in order", async () => {
    const detail = await runToCompletion("Replay me [stub:quick]");
    const runId = detail.runs[0]?.id as string;
    const inbox = await connect();
    send(inbox, {
      type: "subscribe",
      data: { channels: [`run:${runId}`], since: { [`run:${runId}`]: 0 } },
    });
    const events = await waitFor(
      async () => inbox.messages.filter((message) => message.type === "run.event"),
      (list) =>
        list.some(
          (message) =>
            message.type === "run.event" &&
            message.data.items.some(
              (item) => item.kind === "status" && item.status === "COMPLETED",
            ),
        ),
    );
    const seqs = events.map((message) => (message.type === "run.event" ? message.seq : -1));
    expect(seqs).toEqual([...seqs].sort((left, right) => left - right));
    expect(seqs[0]).toBe(1);
    expect(new Set(seqs).size).toBe(seqs.length);
    inbox.socket.terminate();
  });

  it("streams live run lifecycle events on the system channel", async () => {
    const inbox = await connect();
    send(inbox, { type: "subscribe", data: { channels: ["system", `project:${project.id}`] } });
    await waitFor(
      async () => inbox.messages,
      (list) => list.some((message) => message.type === "subscribed"),
    );
    await runToCompletion("Live [stub:quick]");
    const lifecycle = await waitFor(
      async () =>
        inbox.messages.flatMap((message) =>
          message.type === "system.runs" ? [message.data.event] : [],
        ),
      (events) => events.includes("finished"),
    );
    expect(lifecycle).toEqual(["queued", "started", "finished"]);
    const statuses = inbox.messages.flatMap((message) =>
      message.type === "task.status" ? [message.data.status] : [],
    );
    expect(statuses).toEqual(["QUEUED", "RUNNING", "COMPLETED"]);
    inbox.socket.terminate();
  });

  it("answers pings and reports malformed messages", async () => {
    const inbox = await connect();
    send(inbox, { type: "ping" });
    inbox.socket.send("not json");
    send(inbox, { type: "subscribe", data: { channels: ["admin:1"] } });
    const replies = await waitFor(
      async () => inbox.messages.map((message) => message.type),
      (types) => types.filter((type) => type === "error").length === 2 && types.includes("pong"),
    );
    expect(replies).toContain("pong");
    inbox.socket.terminate();
  });
});
