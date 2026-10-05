import { createDecipheriv, createECDH, createHmac, randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type {
  NotificationSettingsDto,
  ProjectDetailDto,
  TaskDetailDto,
  TaskDto,
  TestNotificationResponse,
} from "@onyx/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { base64url } from "../../src/infrastructure/web-push";
import {
  apiClient,
  authenticate,
  createTestContext,
  destroyTestContext,
  waitFor,
  type ApiClient,
  type TestContext,
} from "../helpers";

interface Received {
  path: string;
  headers: IncomingMessage["headers"];
  body: string;
}

let context: TestContext;
let api: ApiClient;
let project: ProjectDetailDto;
let server: Server;
let base: string;
const received: Received[] = [];
const pushed: { endpoint: string; body: Buffer }[] = [];
const receiver = createECDH("prime256v1");
receiver.generateKeys();
const auth = randomBytes(16);

function hmac(key: Buffer, data: Buffer): Buffer {
  return createHmac("sha256", key).update(data).digest();
}

function openPush(body: Buffer): unknown {
  const salt = body.subarray(0, 16);
  const sender = body.subarray(21, 86);
  const info = Buffer.concat([Buffer.from("WebPush: info\0"), receiver.getPublicKey(), sender]);
  const ikm = hmac(
    hmac(auth, receiver.computeSecret(sender)),
    Buffer.concat([info, Buffer.from([1])]),
  );
  const prk = hmac(salt, ikm.subarray(0, 32));
  const derive = (label: string, length: number) =>
    hmac(prk, Buffer.concat([Buffer.from(label), Buffer.from([1])])).subarray(0, length);
  const decipher = createDecipheriv(
    "aes-128-gcm",
    derive("Content-Encoding: aes128gcm\0", 16),
    derive("Content-Encoding: nonce\0", 12),
  );
  const cipherText = body.subarray(86);
  decipher.setAuthTag(cipherText.subarray(cipherText.length - 16));
  const plain = Buffer.concat([
    decipher.update(cipherText.subarray(0, cipherText.length - 16)),
    decipher.final(),
  ]);
  return JSON.parse(plain.subarray(0, -1).toString("utf8"));
}

const fakeFetch: typeof fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.startsWith("https://push.test/")) {
    const body = Buffer.from(init?.body as Uint8Array);
    pushed.push({ endpoint: url, body });
    return new Response(null, { status: url.endsWith("/gone") ? 410 : 201 });
  }
  return fetch(input, init);
};

beforeAll(async () => {
  server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      received.push({
        path: request.url ?? "",
        headers: request.headers,
        body: Buffer.concat(chunks).toString("utf8"),
      });
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end("{}");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  context = await createTestContext({
    fetcher: fakeFetch,
    telegramApiUrl: `${base}/telegram`,
    env: { ONYX_PUBLIC_ORIGIN: "http://onyx.lan:3000" },
  });
  api = apiClient(context.app, await authenticate(context.app));
  project = (
    await api.post<ProjectDetailDto>("/api/projects", {
      name: "shop",
      rootPath: context.projectRoot,
    })
  ).body;
  await context.container.indexes.idle(project.id);
});

afterAll(async () => {
  await destroyTestContext(context);
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function runTask(title: string, prompt: string) {
  const task = (
    await api.post<TaskDto>("/api/tasks", {
      projectId: project.id,
      workspaceId: project.workspaces[0]?.id,
      title,
      prompt,
    })
  ).body;
  await api.post(`/api/tasks/${task.id}/run`, {});
  await waitFor(
    async () => (await api.get<TaskDetailDto>(`/api/tasks/${task.id}`)).body,
    (detail) => detail.status === "COMPLETED" || detail.status === "FAILED",
    20_000,
  );
  await context.container.scheduler.idle();
  await context.container.notifications.idle();
}

describe("notifications", () => {
  it("are off until a channel is set up", async () => {
    const settings = (await api.get<NotificationSettingsDto>("/api/settings/notifications")).body;
    expect(settings).toMatchObject({
      events: { RUN_FINISHED: false, RUN_FAILED: true, RUN_BLOCKED: true },
      webPush: { enabled: false, devices: 0 },
      ntfy: { enabled: false, hasToken: false },
      linkBase: "http://onyx.lan:3000",
    });
    await runTask("Quiet", "[stub:crash] boom");
    expect(received).toHaveLength(0);
  });

  it("keep tokens encrypted and refuse incomplete channels", async () => {
    const bad = await api.put("/api/settings/notifications", {
      ntfy: { enabled: true, server: "", topic: "onyx" },
    });
    expect(bad.status).toBe(400);
    expect(
      (
        await api.put("/api/settings/notifications", {
          telegram: { enabled: true, chatId: "42" },
        })
      ).status,
    ).toBe(400);
    const saved = await api.put<NotificationSettingsDto>("/api/settings/notifications", {
      ntfy: { enabled: true, server: `${base}/ntfy`, topic: "onyx", token: "tk_secret" },
      telegram: { enabled: true, chatId: "42", token: "123:secret" },
    });
    expect(saved.status).toBe(200);
    expect(saved.body.ntfy).toEqual({
      enabled: true,
      server: `${base}/ntfy`,
      topic: "onyx",
      hasToken: true,
    });
    expect(JSON.stringify(saved.body)).not.toContain("secret");
    const row = await context.container.prisma.appSetting.findUnique({
      where: { key: "notifications.settings" },
    });
    expect(JSON.stringify(row?.value)).not.toContain("tk_secret");
    expect(JSON.stringify(row?.value)).not.toContain("123:secret");

    const kept = await api.put<NotificationSettingsDto>("/api/settings/notifications", {
      ntfy: { enabled: true, server: `${base}/ntfy`, topic: "onyx" },
    });
    expect(kept.body.ntfy.hasToken).toBe(true);
  });

  it("send a test and the end of failed runs to every channel", async () => {
    const test = await api.post<TestNotificationResponse>("/api/notifications/test", {
      channel: "ntfy",
    });
    expect(test.body).toEqual({ ok: true, detail: `Sent to ${base}/ntfy/onyx` });
    expect(received.at(-1)).toMatchObject({
      path: "/ntfy/onyx",
      headers: { title: "Onyx test notification", authorization: "Bearer tk_secret" },
    });

    const key = (await api.get<{ publicKey: string }>("/api/notifications/push/key")).body;
    expect(key.publicKey).toMatch(/^[A-Za-z0-9_-]{87}$/);
    const keys = { p256dh: base64url(receiver.getPublicKey()), auth: base64url(auth) };
    expect(
      (
        await api.post("/api/notifications/push/subscriptions", {
          endpoint: "http://push.test/plain",
          keys,
        })
      ).status,
    ).toBe(400);
    for (const endpoint of ["https://push.test/device", "https://push.test/gone"])
      await api.post("/api/notifications/push/subscriptions", { endpoint, keys });
    const subscribed = (await api.get<NotificationSettingsDto>("/api/settings/notifications")).body;
    expect(subscribed.webPush).toEqual({ enabled: true, devices: 2 });

    received.length = 0;
    await runTask("Broken build", "[stub:crash] boom");
    const ntfy = received.find((entry) => entry.path === "/ntfy/onyx");
    expect(ntfy?.headers).toMatchObject({
      title: `=?UTF-8?B?${Buffer.from("Run failed · Broken build").toString("base64")}?=`,
      priority: "high",
    });
    expect(ntfy?.headers["click"]).toMatch(/^http:\/\/onyx\.lan:3000\/runs\//);
    expect(ntfy?.body).toBe("shop: Broken build");
    const telegram = received.find((entry) => entry.path === "/telegram/bot123:secret/sendMessage");
    expect(JSON.parse(telegram?.body ?? "{}")).toMatchObject({
      chat_id: "42",
      parse_mode: "HTML",
    });
    const device = pushed.filter((entry) => entry.endpoint === "https://push.test/device");
    expect(device).toHaveLength(1);
    expect(openPush(device[0]?.body ?? Buffer.alloc(0))).toMatchObject({
      title: "Run failed · Broken build",
      body: "shop: Broken build",
    });
    const after = (await api.get<NotificationSettingsDto>("/api/settings/notifications")).body;
    expect(after.webPush.devices).toBe(1);

    received.length = 0;
    await runTask("Fine", "Small change");
    expect(received).toHaveLength(0);

    await api.post("/api/notifications/push/unsubscribe", {
      endpoint: "https://push.test/device",
    });
    expect(
      (await api.get<NotificationSettingsDto>("/api/settings/notifications")).body.webPush.devices,
    ).toBe(0);
  });
});
