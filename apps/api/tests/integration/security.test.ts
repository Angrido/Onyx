import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ClaudeAccountDto, TaskDto } from "@onyx/contracts";
import { connectDatabase } from "@onyx/db";
import { createTestDatabase } from "@onyx/db/testing";
import { afterAll, describe, expect, it } from "vitest";
import { RunTokenRegistry } from "../../src/infrastructure/run-tokens";
import { SecretVault, SecretVaultError } from "../../src/infrastructure/secret-vault";
import {
  apiClient,
  authenticate,
  createTestContext,
  destroyTestContext,
  ORIGIN,
  waitFor,
} from "../helpers";

const TOKEN = `sk-ant-oat01-${"Zq7".repeat(30)}-AAAA`;
const GITHUB_TOKEN = `github_pat_${"x9".repeat(30)}`;
const scratch = mkdtempSync(join(tmpdir(), "onyx-security-"));

afterAll(() => rmSync(scratch, { recursive: true, force: true }));

describe("secret vault", () => {
  it("seals with AES-GCM bound to the setting name", async () => {
    const vault = await SecretVault.open(join(scratch, "unit", "secret.key"));
    expect(vault.created).toBe(true);
    expect(statSync(join(scratch, "unit", "secret.key")).mode & 0o777).toBe(0o600);
    const sealed = vault.seal("hello", "claude.credential");
    expect(sealed).toMatch(/^onyx:v1:/);
    expect(vault.seal("hello", "claude.credential")).not.toBe(sealed);
    expect(vault.open(sealed, "claude.credential")).toBe("hello");
    expect(() => vault.open(sealed, "github.token")).toThrow(SecretVaultError);
    const tampered = `${sealed.slice(0, -2)}${sealed.endsWith("A") ? "B" : "A"}A`;
    expect(vault.reveal(tampered, "claude.credential")).toBeNull();
    expect(vault.reveal("plain", "claude.credential")).toBe("plain");
    const again = await SecretVault.open(join(scratch, "unit", "secret.key"));
    expect(again.created).toBe(false);
    expect(again.open(sealed, "claude.credential")).toBe("hello");
    const other = SecretVault.fromKey(Buffer.alloc(32, 7).toString("base64"));
    expect(other.reveal(sealed, "claude.credential")).toBeNull();
    expect(() => SecretVault.fromKey("short")).toThrow(SecretVaultError);
  });

  it("expires run tokens even if a run never revokes them", () => {
    let now = 1_000;
    const registry = new RunTokenRegistry(5_000, () => now);
    const token = registry.issue("run-1", "project-1", {
      workspaceId: null,
      policy: {} as never,
      guard: {} as never,
      fence: null,
    });
    expect(registry.resolve(token)?.runId).toBe("run-1");
    now = 6_001;
    expect(registry.resolve(token)).toBeNull();
    expect(registry.usage("run-1")).toEqual({ calls: 0, tokens: 0 });
  });
});

describe("tokens at rest", () => {
  it("stores the Claude token encrypted and still hands it to the agents", async () => {
    const envFile = join(scratch, "child-env.json");
    process.env.ONYX_PRIVATE_PROBE = "must-not-leak";
    const context = await createTestContext({ sourceEnv: { CLAUDE_STUB_ENV_FILE: envFile } });
    try {
      const api = apiClient(context.app, await authenticate(context.app));
      const saved = await api.put<ClaudeAccountDto>("/api/settings/claude/token", {
        token: TOKEN,
      });
      expect(saved.status).toBe(200);
      expect(saved.body.hint).toBe(`${TOKEN.slice(0, 14)}…${TOKEN.slice(-4)}`);
      const row = await context.container.prisma.appSetting.findUniqueOrThrow({
        where: { key: "claude.credential" },
      });
      const stored = JSON.stringify(row.value);
      expect(stored).not.toContain(TOKEN.slice(13, 60));
      expect((row.value as { value: string }).value).toMatch(/^onyx:v1:/);
      expect(statSync(join(context.dataDir, "secret.key")).mode & 0o777).toBe(0o600);

      const project = context.container.prisma.project;
      const created = await api.post<{ id: string; workspaces: Array<{ id: string }> }>(
        "/api/projects",
        { name: "demo", rootPath: context.projectRoot },
      );
      expect(created.status).toBe(201);
      const task = await api.post<TaskDto>("/api/tasks", {
        projectId: created.body.id,
        workspaceId: created.body.workspaces[0]?.id,
        title: "Probe the environment",
        prompt: "Say hello",
        kind: "CHORE",
      });
      await api.post(`/api/tasks/${task.body.id}/run`, {});
      await waitFor(
        async () => (await api.get<TaskDto>(`/api/tasks/${task.body.id}`)).body,
        (value) => value.status === "COMPLETED",
      );
      const keys = JSON.parse(readFileSync(envFile, "utf8")) as string[];
      expect(keys).toContain("CLAUDE_CODE_OAUTH_TOKEN");
      expect(keys).not.toContain("ONYX_PRIVATE_PROBE");
      expect(keys).not.toContain("DATABASE_URL");
      expect(await project.count()).toBe(1);
    } finally {
      delete process.env.ONYX_PRIVATE_PROBE;
      await destroyTestContext(context);
    }
  });

  it("encrypts tokens saved by older versions and ignores them under another key", async () => {
    const database = createTestDatabase();
    const legacy = await connectDatabase({ url: database.url });
    await legacy.appSetting.create({
      data: {
        key: "claude.credential",
        value: { kind: "oauth-token", value: TOKEN, savedAt: "2026-09-01T10:00:00.000Z" },
      },
    });
    await legacy.appSetting.create({ data: { key: "github.token", value: GITHUB_TOKEN } });
    await legacy.$disconnect();

    const firstDir = mkdtempSync(join(tmpdir(), "onyx-api-"));
    const first = await createTestContext({ database, dataDir: firstDir });
    const api = apiClient(first.app, await authenticate(first.app));
    const account = await api.get<ClaudeAccountDto>("/api/settings/claude");
    expect(account.body).toMatchObject({
      configured: true,
      source: "settings",
      kind: "oauth-token",
    });
    const rows = await first.container.prisma.appSetting.findMany({
      where: { key: { in: ["claude.credential", "github.token"] } },
    });
    expect(JSON.stringify(rows)).not.toContain(TOKEN.slice(13, 60));
    expect(JSON.stringify(rows)).not.toContain(GITHUB_TOKEN);
    const github = rows.find((row) => row.key === "github.token");
    expect(github?.value).toMatch(/^onyx:v1:/);
    await first.close();

    const secondDir = mkdtempSync(join(tmpdir(), "onyx-api-"));
    const second = await createTestContext({ database, dataDir: secondDir });
    try {
      const fresh = apiClient(second.app, await loginAgain(second.app));
      const lost = await fresh.get<ClaudeAccountDto>("/api/settings/claude");
      expect(lost.status).toBe(200);
      expect(lost.body.configured).toBe(false);
    } finally {
      await destroyTestContext(second);
      rmSync(firstDir, { recursive: true, force: true });
    }
  });
});

async function loginAgain(app: Parameters<typeof authenticate>[0]): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    headers: { origin: ORIGIN },
    payload: { username: "admin", password: "correct-horse-battery" },
  });
  const cookie = response.cookies.find((entry) => entry.name === "onyx_sid");
  if (!cookie) throw new Error(`Login failed: ${response.body}`);
  return `onyx_sid=${cookie.value}`;
}

describe("request hardening", () => {
  it("rate limits login attempts and marks API responses as private", async () => {
    const context = await createTestContext();
    try {
      const cookie = await authenticate(context.app);
      const statuses: number[] = [];
      for (let attempt = 0; attempt < 11; attempt += 1) {
        const response = await context.app.inject({
          method: "POST",
          url: "/api/auth/login",
          headers: { origin: ORIGIN },
          payload: { username: "admin", password: "wrong-password-123" },
        });
        statuses.push(response.statusCode);
      }
      expect(statuses.slice(0, 10).every((status) => status === 401)).toBe(true);
      expect(statuses[10]).toBe(429);

      const me = await context.app.inject({
        method: "GET",
        url: "/api/auth/me",
        headers: { cookie },
      });
      expect(me.headers["cache-control"]).toBe("no-store");
      expect(me.headers["x-content-type-options"]).toBe("nosniff");
      expect(me.headers["referrer-policy"]).toBe("same-origin");
      const anonymous = await context.app.inject({ method: "GET", url: "/api/settings/claude" });
      expect(anonymous.statusCode).toBe(401);
    } finally {
      await destroyTestContext(context);
    }
  });
});
