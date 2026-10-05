import { execFileSync, spawnSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import {
  cleanDiff,
  migrationProblems,
  nextMigrationName,
  timestampOf,
} from "../prisma/migration-names";

const packageDir = fileURLToPath(new URL("..", import.meta.url));
const migrationsDir = join(packageDir, "prisma", "migrations");
const CORRECTIVE = "20261023090000_tdd_loop_created_at";
const TDD_LOOP = "20261006090000_tdd_loop";
const APPLIED_WITH_COMMENTS = ["20261005090000_roadmap_board"];

const temporary: string[] = [];

function tempDir(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  temporary.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporary.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function migrationsOnDisk(): string[] {
  return readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function git(args: string[]): string {
  return execFileSync("git", ["-C", packageDir, ...args], { encoding: "utf8" });
}

function migrationsByCommit(): string[][] {
  const output = git([
    "log",
    "--reverse",
    "--topo-order",
    "--no-renames",
    "--diff-filter=A",
    "--format=%x00",
    "--name-only",
    "--",
    "prisma/migrations",
  ]);
  return output
    .split("\0")
    .map((block) =>
      block
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.endsWith("/migration.sql"))
        .map((line) => basename(line.slice(0, -"/migration.sql".length))),
    )
    .filter((group) => group.length > 0);
}

describe("migration names", () => {
  it("accepts only YYYYMMDDHHMMSS_snake_case names with a real date", () => {
    expect(timestampOf("20261006090000_tdd_loop")).toBe("20261006090000");
    expect(timestampOf("20261306090000_bad_month")).toBeNull();
    expect(timestampOf("20261006090000_Upper")).toBeNull();
    expect(timestampOf("20261006090000_double__underscore")).toBeNull();
    expect(timestampOf("2026100609000_short")).toBeNull();
  });

  it("names a new migration the day after the last one, at 09:00", () => {
    const existing = ["20261003000000_init", "20261021090000_insights", "20261023090000_fix"];
    expect(nextMigrationName(existing, "queue_limits", new Date("2026-10-04T15:00:00Z"))).toBe(
      "20261024090000_queue_limits",
    );
    expect(nextMigrationName(["20261231090000_x"], "y", new Date("2026-10-04T00:00:00Z"))).toBe(
      "20270101090000_y",
    );
  });

  it("never names a new migration before today", () => {
    expect(
      nextMigrationName(["20261003000000_init"], "late", new Date("2026-12-01T20:00:00Z")),
    ).toBe("20261201090000_late");
    expect(nextMigrationName([], "first", new Date("2026-10-04T08:00:00Z"))).toBe(
      "20261004090000_first",
    );
  });

  it("refuses names Prisma or the order check would reject", () => {
    expect(() => nextMigrationName([], "Add Users", new Date())).toThrow(/not a valid/);
    expect(() => nextMigrationName([], "", new Date())).toThrow(/not a valid/);
  });

  it("keeps only the SQL of a diff", () => {
    const output = [
      "Loaded Prisma config from prisma.config.ts.",
      "",
      "-- CreateTable",
      'CREATE TABLE "A" ("id" TEXT NOT NULL PRIMARY KEY);',
      "",
      "-- CreateIndex",
      'CREATE INDEX "A_id_idx" ON "A"("id");',
      "",
    ].join("\n");
    expect(cleanDiff(output)).toBe(
      'CREATE TABLE "A" ("id" TEXT NOT NULL PRIMARY KEY);\n\nCREATE INDEX "A_id_idx" ON "A"("id");',
    );
    expect(
      cleanDiff("Loaded Prisma config from prisma.config.ts.\n\n-- This is an empty migration.\n"),
    ).toBe("");
  });
});

describe("migration order", () => {
  it("finds badly named, duplicated and out-of-order migrations", () => {
    expect(
      migrationProblems(["20261001090000_a", "20261002090000_b"], [["20261001090000_a"]]),
    ).toEqual([]);
    expect(migrationProblems(["bad_name"], [])).toHaveLength(1);
    expect(migrationProblems(["20261001090000_a", "20261001090000_b"], [])).toHaveLength(1);
    const late = migrationProblems(
      ["20261001090000_a", "20261002090000_b", "20261003090000_c"],
      [["20261001090000_a"], ["20261003090000_c"], ["20261002090000_b"]],
    );
    expect(late).toHaveLength(1);
    expect(late[0]).toMatch(/^20261002090000_b: added after 20261003090000_c/);
    expect(
      migrationProblems(["20261001090000_a", "20261002090000_new"], [["20261003090000_gone"]]),
    ).toEqual([]);
    expect(
      migrationProblems(["20261001090000_new", "20261002090000_a"], [["20261002090000_a"]]),
    ).toHaveLength(1);
    expect(
      migrationProblems(
        ["20261001090000_a", "20261002090000_b"],
        [["20261001090000_a"], ["20261002090000_b"], ["20261001090000_a"]],
      ),
    ).toEqual([]);
  });

  it("has well formed, strictly increasing names, each added after the ones before it", () => {
    const shallow = git(["rev-parse", "--is-shallow-repository"]).trim() === "true";
    if (shallow)
      expect(
        process.env.CI,
        "the order check needs the git history: check out with fetch-depth: 0",
      ).toBeFalsy();
    const history = shallow ? [] : migrationsByCommit();
    expect(migrationProblems(migrationsOnDisk(), history)).toEqual([]);
  });

  it("has no comment lines in the migrations", () => {
    const names = migrationsOnDisk().filter((name) => !APPLIED_WITH_COMMENTS.includes(name));
    for (const name of names) {
      const sql = readFileSync(join(migrationsDir, name, "migration.sql"), "utf8");
      expect(sql.split("\n").filter((line) => line.trimStart().startsWith("--"))).toEqual([]);
    }
  });
});

describe("migrate:new", () => {
  const schema = [
    'datasource db {\n  provider = "sqlite"\n}',
    "model Note {\n  id String @id\n  body String\n}",
    "",
  ].join("\n\n");

  function migrateNew(args: string[]): { status: number | null; stdout: string; stderr: string } {
    const result = spawnSync(
      join(packageDir, "node_modules", ".bin", "tsx"),
      [join(packageDir, "prisma", "new-migration.ts"), ...args],
      { cwd: packageDir, encoding: "utf8" },
    );
    return { status: result.status, stdout: result.stdout, stderr: result.stderr };
  }

  it(
    "writes the diff after the last migration and refuses an empty one",
    { timeout: 60_000 },
    () => {
      const directory = tempDir("onyx-migrate-new-");
      const migrations = join(directory, "migrations");
      mkdirSync(join(migrations, "20261023090000_existing"), { recursive: true });
      writeFileSync(join(migrations, "20261023090000_existing", "migration.sql"), "SELECT 1;\n");
      cpSync(join(migrationsDir, "migration_lock.toml"), join(migrations, "migration_lock.toml"));
      writeFileSync(join(directory, "schema.prisma"), schema);
      const args = ["--migrations", migrations, "--schema", join(directory, "schema.prisma")];

      const created = migrateNew(["notes", ...args]);
      expect(created.stderr).toBe("");
      expect(created.status).toBe(0);
      const sql = readFileSync(join(migrations, "20261024090000_notes", "migration.sql"), "utf8");
      expect(sql).toMatch(/^CREATE TABLE "Note"/);
      expect(sql).not.toMatch(/^--/m);
      expect(sql).not.toMatch(/Loaded Prisma config/);

      const empty = migrateNew(["again", ...args]);
      expect(empty.status).toBe(1);
      expect(empty.stderr).toMatch(/nothing to migrate/);
      expect(readdirSync(migrations).sort()).toEqual([
        "20261023090000_existing",
        "20261024090000_notes",
        "migration_lock.toml",
      ]);
    },
  );

  it("refuses an invalid name without calling Prisma", () => {
    const result = migrateNew(["Bad-Name", "--migrations", migrationsDir]);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/not a valid migration name/);
  });
});

describe("corrective migration for the TDD loop dates", () => {
  type Row = Record<string, unknown>;

  function insert(database: Database.Database, table: string, values: Row): void {
    const columns = database.prepare(`PRAGMA table_info("${table}")`).all() as {
      name: string;
      type: string;
      notnull: number;
      dflt_value: unknown;
      pk: number;
    }[];
    const row: Row = { ...values };
    for (const column of columns) {
      if (column.name in row || !column.notnull || column.dflt_value !== null) continue;
      const type = column.type.toUpperCase();
      row[column.name] =
        type === "DATETIME"
          ? "2026-09-01T00:00:00.000+00:00"
          : type === "INTEGER" || type === "REAL" || type === "BOOLEAN"
            ? 0
            : type === "JSONB"
              ? "{}"
              : `${column.name}-${String(values["id"] ?? "x")}`;
    }
    const names = Object.keys(row);
    database
      .prepare(
        `INSERT INTO "${table}" (${names.map((name) => `"${name}"`).join(", ")}) VALUES (${names.map(() => "?").join(", ")})`,
      )
      .run(...names.map((name) => row[name]));
  }

  function loop(database: Database.Database, id: string, extra: Row): void {
    insert(database, "TddLoop", {
      id,
      taskId: "task-1",
      workspaceId: "workspace-1",
      gates: "[]",
      ...extra,
    });
  }

  it("sets createdAt to startedAt only for loops that existed before the tdd_loop migration", () => {
    const directory = tempDir("onyx-b7-");
    const database = new Database(join(directory, "onyx.db"));
    try {
      const names = migrationsOnDisk();
      expect(names).toContain(CORRECTIVE);
      for (const name of names) {
        if (name === TDD_LOOP) {
          insert(database, "Project", { id: "project-1" });
          insert(database, "Workspace", { id: "workspace-1", projectId: "project-1" });
          insert(database, "Task", { id: "task-1", projectId: "project-1" });
          loop(database, "old-started", { startedAt: "2026-09-20T10:00:00.000+00:00" });
          loop(database, "old-pending", { startedAt: null });
          loop(database, "old-epoch", { startedAt: 1790000000000 });
        }
        if (name === CORRECTIVE) {
          loop(database, "new-loop", {
            createdAt: "2026-10-02T08:00:00.000+00:00",
            startedAt: "2026-10-02T08:00:01.000+00:00",
          });
          loop(database, "new-default", {
            createdAt: "2026-10-02 08:00:00",
            startedAt: "2026-10-02T08:00:05.000+00:00",
          });
        }
        database.exec(readFileSync(join(migrationsDir, name, "migration.sql"), "utf8"));
        if (name === TDD_LOOP) {
          const created = database
            .prepare(`SELECT "createdAt" FROM "TddLoop" WHERE "id" = 'old-started'`)
            .pluck()
            .get() as string;
          expect(created).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
        }
      }
      const rows = Object.fromEntries(
        (
          database.prepare(`SELECT "id", "createdAt", "startedAt" FROM "TddLoop"`).all() as {
            id: string;
            createdAt: unknown;
            startedAt: unknown;
          }[]
        ).map((row) => [row.id, row]),
      );
      expect(rows["old-started"]?.createdAt).toBe("2026-09-20T10:00:00.000+00:00");
      expect(rows["old-pending"]?.createdAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
      expect(rows["old-epoch"]?.createdAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
      expect(rows["new-loop"]?.createdAt).toBe("2026-10-02T08:00:00.000+00:00");
      expect(rows["new-default"]?.createdAt).toBe("2026-10-02 08:00:00");
    } finally {
      database.close();
    }
  });
});
