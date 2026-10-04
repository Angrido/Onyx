import { execFile } from "node:child_process";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listMigrationFiles } from "@onyx/db/testing";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const apiDir = join(import.meta.dirname, "..", "..");
const dbPackage = join(apiDir, "..", "..", "packages", "db");
const BROKEN_MIGRATION = `ALTER TABLE "Project" ADD COLUMN "probe" TEXT;
CREATE TABLE "new_Budget" ("id" TEXT NOT NULL PRIMARY KEY);
INSERT INTO "new_Budget" ("id") SELECT NULL;
`;

let fixtures: string;
let dataDir: string;
let databasePath: string;
let prismaDir: string;

function prismaWorkspace(extraMigration: string | null, upTo?: string): string {
  const directory = join(fixtures, extraMigration === null ? "prisma-ok" : "prisma-broken");
  mkdirSync(join(directory, "prisma", "migrations"), { recursive: true });
  cpSync(join(dbPackage, "prisma.config.ts"), join(directory, "prisma.config.ts"));
  cpSync(join(dbPackage, "prisma", "schema.prisma"), join(directory, "prisma", "schema.prisma"));
  cpSync(
    join(dbPackage, "prisma", "migrations", "migration_lock.toml"),
    join(directory, "prisma", "migrations", "migration_lock.toml"),
  );
  for (const file of listMigrationFiles()) {
    const name = file.split("/").at(-2) ?? "";
    if (upTo !== undefined && name > upTo) continue;
    cpSync(join(file, ".."), join(directory, "prisma", "migrations", name), { recursive: true });
  }
  if (extraMigration !== null) {
    const broken = join(directory, "prisma", "migrations", "29991231000000_broken");
    mkdirSync(broken);
    writeFileSync(join(broken, "migration.sql"), extraMigration);
  }
  symlinkSync(join(dbPackage, "node_modules"), join(directory, "node_modules"));
  return directory;
}

function cli(args: string[]): Promise<{ status: number | null; out: string }> {
  return new Promise((resolve) => {
    execFile(
      join(apiDir, "node_modules", ".bin", "tsx"),
      ["src/cli.ts", ...args],
      {
        cwd: apiDir,
        encoding: "utf8",
        timeout: 120_000,
        env: {
          PATH: process.env.PATH ?? "",
          HOME: process.env.HOME ?? "",
          NODE_ENV: "test",
          LOG_LEVEL: "silent",
          DATABASE_URL: `file:${databasePath}`,
          ONYX_DATA_DIR: dataDir,
          ONYX_PROJECTS_DIR: join(dataDir, "projects"),
          ONYX_INTERNAL_API_URL: "http://127.0.0.1:1",
        },
      },
      (error, stdout, stderr) => {
        const code = error && typeof error.code === "number" ? error.code : error ? null : 0;
        resolve({ status: code, out: `${stdout}${stderr}` });
      },
    );
  });
}

function snapshot(): { projects: unknown[]; tables: string[]; pending: number } {
  const database = new Database(databasePath, { readonly: true });
  try {
    return {
      projects: database.prepare(`SELECT * FROM "Project" ORDER BY "id"`).all(),
      tables: database
        .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`)
        .all()
        .map((row) => (row as { name: string }).name),
      pending: (
        database
          .prepare(`SELECT COUNT(*) AS count FROM "_prisma_migrations" WHERE finished_at IS NULL`)
          .get() as { count: number }
      ).count,
    };
  } finally {
    database.close();
  }
}

async function oldDatabaseWithData(): Promise<void> {
  const deployed = await cli(["migrate", "--prisma-dir", prismaWorkspace(null)]);
  expect(deployed.out).toContain("The database is up to date");
  expect(deployed.status).toBe(0);
  const database = new Database(databasePath);
  database
    .prepare(
      `INSERT INTO "Project" ("id", "name", "rootPath", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?)`,
    )
    .run("p1", "shop", "/srv/onyx/projects/shop", Date.now(), Date.now());
  database.close();
}

beforeEach(() => {
  fixtures = mkdtempSync(join(tmpdir(), "onyx-migrate-"));
  dataDir = join(fixtures, "data");
  mkdirSync(dataDir);
  databasePath = join(dataDir, "onyx.db");
  prismaDir = "";
});

afterEach(() => {
  rmSync(fixtures, { recursive: true, force: true });
});

describe("onyx-cli migrate", () => {
  it("puts the database back as it was when a migration fails half way", async () => {
    await oldDatabaseWithData();
    const before = snapshot();
    prismaDir = prismaWorkspace(BROKEN_MIGRATION);

    const failed = await cli(["migrate", "--prisma-dir", prismaDir]);
    expect(failed.status).toBe(1);
    expect(failed.out).toContain("The migration failed: the database is back as it was");
    expect(snapshot()).toEqual(before);
    expect(before.pending).toBe(0);

    const backups = readdirSync(join(dataDir, "backups"));
    expect(backups.some((name) => /-pre-update\.db$/.test(name))).toBe(true);
    expect(backups.some((name) => /-pre-restore\.db$/.test(name))).toBe(true);

    const again = await cli(["migrate", "--prisma-dir", prismaDir]);
    expect(again.status).toBe(1);
    expect(again.out).not.toContain("P3009");
    expect(snapshot()).toEqual(before);
  }, 120_000);

  it("migrates nothing when the backup before the update cannot be written", async () => {
    await oldDatabaseWithData();
    const before = snapshot();
    const backups = join(dataDir, "backups");
    rmSync(backups, { recursive: true, force: true });
    writeFileSync(backups, "not a directory");
    chmodSync(backups, 0o400);

    const refused = await cli(["migrate", "--prisma-dir", prismaWorkspace(BROKEN_MIGRATION)]);
    expect(refused.status).toBe(1);
    expect(refused.out).toMatch(/^error: /m);
    expect(snapshot()).toEqual(before);
  }, 120_000);

  it("upgrades an old database without losing its rows", async () => {
    const old = listMigrationFiles()
      .map((file) => file.split("/").at(-2) ?? "")
      .find((name) => name.endsWith("_roadmap_board"));
    expect(old).toBeDefined();
    const initial = await cli(["migrate", "--prisma-dir", prismaWorkspace(null, old)]);
    expect(initial.status).toBe(0);
    const database = new Database(databasePath);
    database
      .prepare(
        `INSERT INTO "Project" ("id", "name", "rootPath", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?)`,
      )
      .run("p1", "shop", "/srv/onyx/projects/shop", Date.now(), Date.now());
    database.close();
    rmSync(join(fixtures, "prisma-ok"), { recursive: true, force: true });

    const upgraded = await cli(["migrate", "--prisma-dir", prismaWorkspace(null)]);
    expect(upgraded.status).toBe(0);
    expect(upgraded.out).toContain("Backup written before the migration");
    const after = snapshot();
    expect(after.projects).toHaveLength(1);
    expect(after.projects[0]).toMatchObject({ id: "p1", name: "shop" });
    expect(after.pending).toBe(0);
    expect(existsSync(databasePath)).toBe(true);
  }, 120_000);
});
