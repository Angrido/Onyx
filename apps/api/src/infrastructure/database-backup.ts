import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  copyFile,
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import Database from "better-sqlite3";

export const BACKUP_FILE_PATTERN = /^onyx-(\d{8})-(\d{6})(?:-([a-z0-9-]+))?\.db$/;
export const BACKUP_REASONS = ["manual", "scheduled", "pre-update", "pre-restore"] as const;
export type BackupReason = (typeof BACKUP_REASONS)[number];

const COUNTED_TABLES = [
  "Project",
  "Task",
  "AgentRun",
  "Session",
  "Orchestration",
  "Approval",
  "Budget",
  "User",
] as const;

export interface DatabaseInspection {
  ok: boolean;
  problems: string[];
  migrations: string[];
  counts: Record<string, number>;
}

export interface BackupManifest {
  format: 1;
  file: string;
  createdAt: string;
  reason: BackupReason;
  sizeBytes: number;
  sha256: string;
  migrations: string[];
  counts: Record<string, number>;
  keyFingerprint: string | null;
}

export interface BackupEntry {
  file: string;
  path: string;
  createdAt: string;
  sizeBytes: number;
  manifest: BackupManifest | null;
}

export class BackupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BackupError";
  }
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function backupFileName(now: Date, reason: BackupReason): string {
  const date = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}`;
  const time = `${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`;
  return `onyx-${date}-${time}${reason === "manual" || reason === "scheduled" ? "" : `-${reason}`}.db`;
}

export function manifestPath(backupPath: string): string {
  return backupPath.replace(/\.db$/, ".json");
}

export function isBackupFileName(name: string): boolean {
  return BACKUP_FILE_PATTERN.test(name);
}

function createdAtFromName(name: string): string | null {
  const match = BACKUP_FILE_PATTERN.exec(name);
  if (!match?.[1] || !match[2]) return null;
  const [d, t] = [match[1], match[2]];
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T${t.slice(0, 2)}:${t.slice(2, 4)}:${t.slice(4, 6)}.000Z`;
}

export async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

export function inspectDatabase(path: string): DatabaseInspection {
  let database: Database.Database | null = null;
  try {
    database = new Database(path, { readonly: true, fileMustExist: true });
    const integrity = database.pragma("integrity_check") as Array<{ integrity_check: string }>;
    const problems = integrity.map((row) => row.integrity_check).filter((value) => value !== "ok");
    const tables = new Set(
      (
        database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{
          name: string;
        }>
      ).map((row) => row.name),
    );
    if (!tables.has("Project") || !tables.has("Task"))
      problems.push("This is not an Onyx database: the Project and Task tables are missing");
    const migrations = tables.has("_prisma_migrations")
      ? (
          database
            .prepare(
              "SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name",
            )
            .all() as Array<{ migration_name: string }>
        ).map((row) => row.migration_name)
      : [];
    const counts: Record<string, number> = {};
    for (const table of COUNTED_TABLES) {
      if (!tables.has(table)) continue;
      const row = database.prepare(`SELECT COUNT(*) AS total FROM "${table}"`).get() as {
        total: number;
      };
      counts[table] = row.total;
    }
    return { ok: problems.length === 0, problems, migrations, counts };
  } catch (error) {
    return {
      ok: false,
      problems: [error instanceof Error ? error.message : String(error)],
      migrations: [],
      counts: {},
    };
  } finally {
    database?.close();
  }
}

async function removeSidecars(path: string): Promise<void> {
  await rm(`${path}-wal`, { force: true });
  await rm(`${path}-shm`, { force: true });
}

async function snapshot(source: string, target: string): Promise<void> {
  const database = new Database(source, { fileMustExist: true });
  try {
    await database.backup(target);
  } finally {
    database.close();
  }
  const copy = new Database(target, { fileMustExist: true });
  try {
    copy.pragma("journal_mode = DELETE");
  } finally {
    copy.close();
  }
  await removeSidecars(target);
}

async function syncFile(path: string): Promise<void> {
  const handle = await open(path, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export interface WriteBackupInput {
  databasePath: string;
  dir: string;
  reason: BackupReason;
  keyFingerprint: string | null;
  now?: Date;
}

export async function writeBackup(input: WriteBackupInput): Promise<BackupManifest> {
  await mkdir(input.dir, { recursive: true, mode: 0o700 });
  const now = input.now ?? new Date();
  let file = backupFileName(now, input.reason);
  for (
    let suffix = 2;
    await stat(join(input.dir, file)).then(
      () => true,
      () => false,
    );
    suffix += 1
  )
    file = backupFileName(new Date(now.getTime() + suffix * 1_000), input.reason);
  const target = join(input.dir, file);
  const partial = `${target}.partial`;
  await rm(partial, { force: true });
  try {
    await snapshot(input.databasePath, partial);
    await syncFile(partial);
    const inspection = inspectDatabase(partial);
    if (!inspection.ok)
      throw new BackupError(
        `The snapshot failed its integrity check: ${inspection.problems.join("; ")}`,
      );
    await rename(partial, target);
    const info = await stat(target);
    const manifest: BackupManifest = {
      format: 1,
      file,
      createdAt: now.toISOString(),
      reason: input.reason,
      sizeBytes: info.size,
      sha256: await sha256File(target),
      migrations: inspection.migrations,
      counts: inspection.counts,
      keyFingerprint: input.keyFingerprint,
    };
    await writeFile(manifestPath(target), `${JSON.stringify(manifest, null, 2)}\n`, {
      mode: 0o600,
    });
    return manifest;
  } catch (error) {
    await rm(partial, { force: true });
    await removeSidecars(partial);
    throw error;
  }
}

async function readManifest(path: string): Promise<BackupManifest | null> {
  const text = await readFile(manifestPath(path), "utf8").catch(() => null);
  if (text === null) return null;
  try {
    const parsed = JSON.parse(text) as BackupManifest;
    return parsed.format === 1 ? parsed : null;
  } catch {
    return null;
  }
}

export async function listBackups(dir: string): Promise<BackupEntry[]> {
  const names = await readdir(dir).catch(() => [] as string[]);
  const entries: BackupEntry[] = [];
  for (const file of names.filter(isBackupFileName)) {
    const path = join(dir, file);
    const info = await stat(path).catch(() => null);
    if (!info?.isFile()) continue;
    const manifest = await readManifest(path);
    entries.push({
      file,
      path,
      createdAt: manifest?.createdAt ?? createdAtFromName(file) ?? info.mtime.toISOString(),
      sizeBytes: info.size,
      manifest,
    });
  }
  return entries.sort(
    (a, b) => b.createdAt.localeCompare(a.createdAt) || b.file.localeCompare(a.file),
  );
}

export async function pruneBackups(dir: string, keep: number): Promise<string[]> {
  const entries = await listBackups(dir);
  const removed: string[] = [];
  for (const entry of entries.slice(keep)) {
    await rm(entry.path, { force: true });
    await rm(manifestPath(entry.path), { force: true });
    removed.push(entry.file);
  }
  return removed;
}

export interface VerifyResult {
  ok: boolean;
  problems: string[];
  inspection: DatabaseInspection;
}

export async function verifyBackup(path: string): Promise<VerifyResult> {
  const problems: string[] = [];
  const manifest = await readManifest(path);
  if (manifest) {
    const actual = await sha256File(path).catch(() => null);
    if (actual !== manifest.sha256)
      problems.push("The file does not match the checksum recorded when it was written");
  }
  const inspection = inspectDatabase(path);
  problems.push(...inspection.problems);
  return { ok: problems.length === 0, problems, inspection };
}

export async function resolveBackup(dir: string, reference: string): Promise<string> {
  if (reference === "latest") {
    const latest = (await listBackups(dir)).find(
      (entry) => entry.manifest?.reason !== "pre-restore",
    );
    if (!latest) throw new BackupError(`No backup in ${dir}`);
    return latest.path;
  }
  if (isBackupFileName(reference)) return join(dir, reference);
  if (reference.includes("/") && isBackupFileName(basename(reference))) return reference;
  throw new BackupError(
    `"${reference}" is not a backup name (onyx-YYYYMMDD-HHMMSS.db) or "latest"`,
  );
}

export interface RestoreInput {
  databasePath: string;
  backupPath: string;
  dir: string;
  keyFingerprint: string | null;
  now?: Date;
}

export interface RestoreResult {
  restored: string;
  safety: BackupManifest | null;
  inspection: DatabaseInspection;
  keyMatches: boolean | null;
}

export async function restoreDatabase(input: RestoreInput): Promise<RestoreResult> {
  const check = await verifyBackup(input.backupPath);
  if (!check.ok)
    throw new BackupError(`The backup cannot be restored: ${check.problems.join("; ")}`);
  const manifest = await readManifest(input.backupPath);
  const exists = await stat(input.databasePath).then(
    () => true,
    () => false,
  );
  const safety = exists
    ? await writeBackup({
        databasePath: input.databasePath,
        dir: input.dir,
        reason: "pre-restore",
        keyFingerprint: input.keyFingerprint,
        ...(input.now ? { now: input.now } : {}),
      })
    : null;
  await mkdir(dirname(input.databasePath), { recursive: true });
  const staging = `${input.databasePath}.restoring`;
  await copyFile(input.backupPath, staging);
  await syncFile(staging);
  await removeSidecars(input.databasePath);
  await rename(staging, input.databasePath);
  return {
    restored: basename(input.backupPath),
    safety,
    inspection: check.inspection,
    keyMatches:
      manifest?.keyFingerprint && input.keyFingerprint
        ? manifest.keyFingerprint === input.keyFingerprint
        : null,
  };
}
