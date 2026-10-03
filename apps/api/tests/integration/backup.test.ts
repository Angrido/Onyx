import { execFile } from "node:child_process";
import {
  copyFileSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  BackupDto,
  BackupListResponse,
  BackupVerifyResult,
  BudgetDto,
  BudgetListResponse,
  ClaudeAccountDto,
  ProjectDetailDto,
  TaskDto,
} from "@onyx/contracts";
import { createTestDatabase, type TestDatabase } from "@onyx/db/testing";
import { pino } from "pino";
import { afterAll, describe, expect, it } from "vitest";
import { BackupService } from "../../src/application/backup-service";
import { loadConfig } from "../../src/config";
import {
  apiClient,
  authenticate,
  createTestContext,
  ORIGIN,
  PASSWORD,
  type TestContext,
} from "../helpers";

const apiDir = join(import.meta.dirname, "..", "..");
const TOKEN = `sk-ant-oat01-${"Bk9".repeat(30)}-AAAA`;

let database: TestDatabase;
let dataDir: string;

function cli(
  args: string[],
  extra: Record<string, string> = {},
): Promise<{ status: number | null; out: string }> {
  return new Promise((resolve) => {
    execFile(
      join(apiDir, "node_modules", ".bin", "tsx"),
      ["src/cli.ts", ...args],
      {
        cwd: apiDir,
        encoding: "utf8",
        timeout: 60_000,
        env: {
          PATH: process.env.PATH ?? "",
          HOME: process.env.HOME ?? "",
          NODE_ENV: "test",
          LOG_LEVEL: "silent",
          DATABASE_URL: database.url,
          ONYX_DATA_DIR: dataDir,
          ONYX_PROJECTS_DIR: join(dataDir, "projects"),
          ONYX_INTERNAL_API_URL: "http://127.0.0.1:1",
          ...extra,
        },
      },
      (error, stdout, stderr) => {
        const code = error && typeof error.code === "number" ? error.code : error ? null : 0;
        resolve({ status: code, out: `${stdout}${stderr}` });
      },
    );
  });
}

async function login(context: TestContext): Promise<string> {
  const response = await context.app.inject({
    method: "POST",
    url: "/api/auth/login",
    headers: { origin: ORIGIN },
    payload: { username: "admin", password: PASSWORD },
  });
  const cookie = response.cookies.find((entry) => entry.name === "onyx_sid");
  if (!cookie) throw new Error(`Login failed: ${response.body}`);
  return `onyx_sid=${cookie.value}`;
}

afterAll(() => {
  database?.cleanup();
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
});

describe("backup and restore", () => {
  it("restores the database from a backup taken while Onyx was running", async () => {
    database = createTestDatabase();
    dataDir = mkdtempSync(join(tmpdir(), "onyx-backup-"));

    const first = await createTestContext({ database, dataDir });
    const api = apiClient(first.app, await authenticate(first.app));
    const project = await api.post<ProjectDetailDto>("/api/projects", {
      name: "demo",
      rootPath: first.projectRoot,
    });
    expect(project.status).toBe(201);
    const task = await api.post<TaskDto>("/api/tasks", {
      projectId: project.body.id,
      workspaceId: project.body.workspaces[0]?.id,
      title: "Keep me",
      prompt: "A task that must survive the restore",
      kind: "CHORE",
    });
    expect(task.status).toBe(201);
    const budget = await api.post<BudgetDto>("/api/budgets", {
      scope: "GLOBAL",
      period: "MONTH",
      softUsd: 5,
      hardUsd: 10,
    });
    expect(budget.status).toBe(201);
    const saved = await api.put<ClaudeAccountDto>("/api/settings/claude/token", { token: TOKEN });
    expect(saved.body.configured).toBe(true);

    const created = await api.post<BackupDto>("/api/backups");
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      reason: "manual",
      keyMatches: true,
      counts: { Project: 1, Task: 1, Budget: 1, User: 1 },
    });
    expect(created.body.name).toMatch(/^onyx-\d{8}-\d{6}\.db$/);
    const listing = await api.get<BackupListResponse>("/api/backups");
    expect(listing.body).toMatchObject({
      dir: join(dataDir, "backups"),
      keep: 14,
      intervalHours: 24,
      lastBackupAt: created.body.createdAt,
      running: false,
    });
    const verified = await api.post<BackupVerifyResult>(`/api/backups/${created.body.name}/verify`);
    expect(verified.body).toMatchObject({ ok: true, problems: [] });
    const download = await first.app.inject({
      method: "GET",
      url: `/api/backups/${created.body.name}/download`,
      headers: { cookie: await login(first) },
    });
    expect(download.statusCode).toBe(200);
    expect(download.headers["content-disposition"]).toBe(
      `attachment; filename="${created.body.name}"`,
    );
    expect(download.rawPayload.subarray(0, 15).toString()).toBe("SQLite format 3");
    expect((await api.get(`/api/backups/..%2Fonyx.db/download`)).status).toBe(400);

    expect((await api.delete(`/api/projects/${project.body.id}`)).status).toBe(204);
    await api.post("/api/budgets", { scope: "GLOBAL", period: "DAY", softUsd: null, hardUsd: 3 });
    await api.delete("/api/settings/claude/token");
    await first.close();

    const listed = await cli(["list"]);
    expect(listed.status).toBe(0);
    expect(listed.out).toContain(created.body.name);
    expect(readdirSync(join(dataDir, "backups")).sort()).toEqual([
      created.body.name,
      created.body.name.replace(".db", ".json"),
    ]);
    expect((await cli(["verify", "latest"])).status).toBe(0);

    const restored = await cli(["restore", created.body.name]);
    expect(restored.out).toContain(`Restored ${created.body.name}`);
    expect(restored.status).toBe(0);
    const safetyName = /saved as (onyx-\S+\.db)/.exec(restored.out)?.[1];
    expect(safetyName).toMatch(/-pre-restore\.db$/);

    const second = await createTestContext({ database, dataDir });
    try {
      const again = apiClient(second.app, await login(second));
      const projects = await again.get<{ items: Array<{ id: string }> }>("/api/projects");
      expect(projects.body.items.map((item) => item.id)).toEqual([project.body.id]);
      const kept = await again.get<TaskDto>(`/api/tasks/${task.body.id}`);
      expect(kept.body.title).toBe("Keep me");
      const budgets = await again.get<BudgetListResponse>("/api/budgets");
      expect(budgets.body.items.map((item) => item.id)).toEqual([budget.body.id]);
      const account = await again.get<ClaudeAccountDto>("/api/settings/claude");
      expect(account.body).toMatchObject({ configured: true, hint: saved.body.hint });

      const after = await again.get<BackupListResponse>("/api/backups");
      const safety = after.body.items.find((item) => item.name === safetyName);
      expect(safety).toMatchObject({ reason: "pre-restore", counts: { Project: 0, Budget: 2 } });

      await second.app.listen({ host: "127.0.0.1", port: 0 });
      const address = second.app.server.address();
      if (address === null || typeof address === "string") throw new Error("not listening");
      const refused = await cli(["restore", "latest"], {
        ONYX_INTERNAL_API_URL: `http://127.0.0.1:${address.port}`,
      });
      expect(refused.status).toBe(1);
      expect(refused.out).toContain("Onyx is running");
    } finally {
      await second.close();
    }

    const backups = join(dataDir, "backups");
    const damaged = "onyx-20200101-000000.db";
    copyFileSync(join(backups, created.body.name), join(backups, damaged));
    writeFileSync(
      join(backups, damaged.replace(".db", ".json")),
      readFileSync(join(backups, created.body.name.replace(".db", ".json")), "utf8").replace(
        created.body.name,
        damaged,
      ),
    );
    truncateSync(join(backups, damaged), 4096);
    const broken = await cli(["verify", damaged]);
    expect(broken.status).toBe(1);
    expect(broken.out).toContain("checksum");
    const rejected = await cli(["restore", damaged]);
    expect(rejected.status).toBe(1);
    expect(rejected.out).toContain("cannot be restored");
    expect((await cli(["restore", "../onyx.db"])).status).toBe(1);
    expect((await cli(["frobnicate"])).status).toBe(2);
  }, 120_000);

  it("backs up on schedule and keeps the newest copies", async () => {
    const scheduleDb = createTestDatabase();
    const dir = mkdtempSync(join(tmpdir(), "onyx-schedule-"));
    let now = new Date("2026-10-03T08:00:00Z");
    const config = loadConfig({
      DATABASE_URL: scheduleDb.url,
      ONYX_DATA_DIR: dir,
      ONYX_BACKUP_KEEP: "2",
      ONYX_BACKUP_INTERVAL_HOURS: "24",
    });
    const service = new BackupService({
      prisma: { auditLog: { create: () => Promise.resolve() } } as never,
      logger: pino({ level: "silent" }),
      config,
      keyFingerprint: "abc",
      now: () => now,
    });
    try {
      expect(await service.tick()).toBe(true);
      now = new Date("2026-10-03T20:00:00Z");
      expect(await service.tick()).toBe(false);
      now = new Date("2026-10-04T08:00:01Z");
      expect(await service.tick()).toBe(true);
      now = new Date("2026-10-05T09:00:00Z");
      expect(await service.tick()).toBe(true);
      const listing = await service.list();
      expect(listing.items.map((item) => item.name)).toEqual([
        "onyx-20261005-090000.db",
        "onyx-20261004-080001.db",
      ]);
      expect(listing.nextBackupAt).toBe("2026-10-06T09:00:00.000Z");
      expect(listing.items[0]).toMatchObject({ reason: "scheduled", keyMatches: true });
    } finally {
      await service.stop();
      scheduleDb.cleanup();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
