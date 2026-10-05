import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DiagnosticsBundleSchema, type QueueDto } from "@onyx/contracts";
import type { PrismaClient } from "@onyx/db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DiagnosticsService,
  diagnosticsFileName,
  safeConfig,
} from "../../src/application/diagnostics-service";
import { loadConfig, type AppConfig } from "../../src/config";
import { LogBuffer } from "../../src/infrastructure/log-buffer";
import { createLogger } from "../../src/logger";
import { Writable } from "node:stream";

const SECRETS = {
  apiKey: "sk-ant-api03-SEEDEDfakeKEY0123456789abcdefghijklmnop",
  github: "ghp_SEEDEDfakeGitHubToken0123456789abcd",
  secretKey: "c2VlZGVkLWZha2Utc2VjcmV0LWtleS0wMTIzNDU2Nzg5",
  password: "seeded-console-password",
  telegram: "987654321:AAseededFakeTelegramBotToken0123456789",
  vapid: "seededVapidPrivateKey_0123456789abcdefghijk",
  cookie: "seededSessionCookieValue0123456789",
  originPassword: "seededOriginPass",
};

let dataDir: string;
let config: AppConfig;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "onyx-diag-"));
  writeFileSync(join(dataDir, "onyx.db"), "x".repeat(4096));
  config = loadConfig({
    NODE_ENV: "production",
    DATABASE_URL: `file:${join(dataDir, "onyx.db")}?connection_limit=1`,
    ONYX_DATA_DIR: dataDir,
    ONYX_PROJECTS_DIR: join(dataDir, "projects"),
    ONYX_ALLOWED_ORIGINS: `http://admin:${SECRETS.originPassword}@onyx.local`,
    ANTHROPIC_API_KEY: SECRETS.apiKey,
    ONYX_GITHUB_TOKEN: SECRETS.github,
    ONYX_SECRET_KEY: SECRETS.secretKey,
  });
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

function fakePrisma(): PrismaClient {
  return {
    $queryRawUnsafe: async (sql: string) => {
      if (sql.includes("sqlite_master"))
        return [{ name: "Project" }, { name: "Task" }, { name: "_prisma_migrations" }];
      if (sql.includes("_prisma_migrations"))
        return [
          { migration_name: "20260101000000_init" },
          { migration_name: "20261022090000_recovery" },
        ];
      if (sql.includes('"Project"')) return [{ total: 2n }];
      return [{ total: 7 }];
    },
  } as unknown as PrismaClient;
}

const QUEUE: QueueDto = {
  items: [
    {
      taskId: "t1",
      title: `uses ${SECRETS.github}`,
      projectId: null,
      projectName: null,
      workspaceName: null,
      kind: "TASK",
      priority: 0,
      effectivePriority: 0,
      position: 1,
      enqueuedAt: "2026-10-04T10:00:00.000Z",
      canWait: false,
      waiting: "SLOTS",
    },
  ],
  active: [],
  projects: [],
  maxConcurrent: 2,
  reservedSlots: 0,
  settings: { projectLimit: null, agingMinutes: 30 },
};

function logs(): LogBuffer {
  const buffer = new LogBuffer(100);
  const logger = createLogger(
    { env: "production", logLevel: "info" },
    {
      buffer,
      destination: new Writable({
        write(_chunk, _encoding, done) {
          done();
        },
      }),
    },
  );
  logger.warn({ token: SECRETS.github, password: SECRETS.password }, "GitHub push refused");
  logger.error(
    {
      headers: { cookie: `onyx_sid=${SECRETS.cookie}`, authorization: `Bearer ${SECRETS.apiKey}` },
    },
    `Telegram failed at https://api.telegram.org/bot${SECRETS.telegram}/sendMessage`,
  );
  logger.error({ settings: { vapid: { privateKey: SECRETS.vapid } } }, "Push setup failed");
  logger.info({ env: { ANTHROPIC_API_KEY: SECRETS.apiKey } }, "Started");
  return buffer;
}

function service(buffer = logs()): DiagnosticsService {
  return new DiagnosticsService({
    config,
    prisma: fakePrisma(),
    logs: buffer,
    readiness: async () => ({
      ready: false,
      checks: [
        { name: "database", ok: true, detail: null },
        { name: "credentials", ok: true, detail: `api-key ${SECRETS.apiKey}` },
      ],
      cliVersion: "2.1.0 (Claude Code)",
    }),
    cliVersion: () => "2.1.0 (Claude Code)",
    cliCompatibility: () => ({
      version: "2.1.0",
      ok: false,
      missingFlags: ["--settings"],
      missingModes: ["plan"],
      missingCommands: [],
      error: null,
      checkedAt: "2026-10-04T10:00:00.000Z",
    }),
    queue: async () => QUEUE,
    secrets: async () => ({ ANTHROPIC_API_KEY: true, telegramBotToken: true, vapidKeys: false }),
    recovery: () => ({ interruptedRuns: 1, killedProcesses: 0 }),
    buildInfo: async () => ({ version: "0.1.0", commit: "abc1234" }),
    statfs: async () => ({ bavail: 50, blocks: 100, bsize: 1024 }),
    now: () => new Date("2026-10-04T10:00:00.000Z"),
  });
}

describe("diagnostics bundle", () => {
  it("never contains a seeded secret", async () => {
    const bundle = await service().bundle();
    const text = JSON.stringify(bundle);
    expect(Object.values(SECRETS).filter((secret) => text.includes(secret))).toEqual([]);
    expect(text).not.toContain("sk-ant-");
    expect(text).not.toContain("ghp_");
  });

  it("reports secrets only as set or not set", async () => {
    const bundle = await service().bundle();
    expect(bundle.secrets).toEqual({
      ANTHROPIC_API_KEY: "set",
      telegramBotToken: "set",
      vapidKeys: "not set",
    });
  });

  it("matches the contract and holds the expected sections", async () => {
    const bundle = DiagnosticsBundleSchema.parse(await service().bundle());
    expect(bundle.onyx).toMatchObject({ version: "0.1.0", commit: "abc1234" });
    expect(bundle.runtime.node).toBe(process.version);
    expect(bundle.claude).toEqual({
      version: "2.1.0 (Claude Code)",
      compatible: false,
      missing: ["--settings", "permission mode plan"],
      error: null,
    });
    expect(bundle.config).toMatchObject({
      env: "production",
      claudeLogin: "api-key",
      databaseFile: join(dataDir, "onyx.db"),
      dataDir,
    });
    expect(bundle.recovery).toEqual({ interruptedRuns: 1, killedProcesses: 0 });
    expect(bundle.logs.recent.map((entry) => entry.msg)).toEqual([
      "Push setup failed",
      expect.stringContaining("Telegram failed"),
      "GitHub push refused",
    ]);
    expect(bundle.database).toMatchObject({
      fileBytes: 4096,
      migrations: 2,
      lastMigration: "20261022090000_recovery",
      error: null,
    });
    expect(bundle.database.tables.find((row) => row.table === "Project")?.rows).toBe(2);
    expect(bundle.database.tables.find((row) => row.table === "AgentRun")?.rows).toBeNull();
    expect(bundle.queue).toMatchObject({ queued: 1, running: 0, waiting: { SLOTS: 1 } });
    expect(bundle.disk.map((disk) => [disk.name, disk.freeRatio])).toEqual([
      ["data", 0.5],
      ["projects", 0.5],
      ["backups", 0.5],
    ]);
  });

  it("keeps working when a part fails", async () => {
    const broken = new DiagnosticsService({
      config,
      prisma: {
        $queryRawUnsafe: async () => {
          throw new Error(`database locked at ${SECRETS.github}`);
        },
      } as unknown as PrismaClient,
      logs: new LogBuffer(5),
      readiness: async () => {
        throw new Error("readiness exploded");
      },
      cliVersion: () => null,
      cliCompatibility: () => null,
      queue: async () => {
        throw new Error("no queue");
      },
      secrets: async () => {
        throw new Error("vault closed");
      },
      buildInfo: async () => ({ version: null, commit: null }),
      statfs: async () => {
        throw Object.assign(new Error("gone"), { code: "ENOENT" });
      },
    });
    const bundle = await broken.bundle();
    expect(bundle.database.error).toContain("database locked");
    expect(JSON.stringify(bundle)).not.toContain(SECRETS.github);
    expect(bundle.readiness.ready).toBe(false);
    expect(bundle.queue.queued).toBe(0);
    expect(bundle.secrets).toEqual({});
    expect(bundle.disk[0]).toMatchObject({ freeBytes: null, error: "ENOENT" });
    expect(bundle.claude.compatible).toBeNull();
  });

  it("lists the configuration through an allow-list", () => {
    const listed = safeConfig(config);
    const text = JSON.stringify(listed);
    expect(text).not.toContain(SECRETS.apiKey);
    expect(text).not.toContain(SECRETS.github);
    expect(text).not.toContain(SECRETS.secretKey);
    expect(text).not.toContain("connection_limit");
    expect(listed).not.toHaveProperty("credentials");
    expect(listed).not.toHaveProperty("secrets");
    expect(listed).not.toHaveProperty("github");
  });

  it("names the file after the moment it was made", () => {
    expect(diagnosticsFileName(new Date("2026-10-04T09:08:07.123Z"))).toBe(
      "onyx-diagnostics-20261004-090807.json",
    );
  });
});
