import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const MIGRATIONS_DIR = fileURLToPath(new URL("../prisma/migrations", import.meta.url));

export function listMigrationFiles(directory = MIGRATIONS_DIR): string[] {
  return readdirSync(directory)
    .filter((entry) => statSync(join(directory, entry)).isDirectory())
    .sort()
    .map((entry) => join(directory, entry, "migration.sql"));
}

export function applyMigrations(databasePath: string, directory = MIGRATIONS_DIR): void {
  const database = new Database(databasePath);
  try {
    database.pragma("journal_mode = WAL");
    for (const file of listMigrationFiles(directory)) {
      database.exec(readFileSync(file, "utf8"));
    }
  } finally {
    database.close();
  }
}

export interface TestDatabase {
  directory: string;
  path: string;
  url: string;
  cleanup: () => void;
}

export function createTestDatabase(): TestDatabase {
  const directory = mkdtempSync(join(tmpdir(), "onyx-db-"));
  const path = join(directory, "onyx.db");
  applyMigrations(path);
  return {
    directory,
    path,
    url: `file:${path}`,
    cleanup: () => rmSync(directory, { recursive: true, force: true }),
  };
}
