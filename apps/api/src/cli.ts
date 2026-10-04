import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { checkCliCompatibility } from "@onyx/agent-runtime";
import { sqliteFilePathFromUrl } from "@onyx/db";
import { loadConfig, type AppConfig } from "./config";
import {
  BACKUP_REASONS,
  BackupError,
  listBackups,
  pruneBackups,
  resolveBackup,
  restoreDatabase,
  verifyBackup,
  writeBackup,
  type BackupReason,
} from "./infrastructure/database-backup";
import { migrateSafely } from "./infrastructure/safe-migration";
import { SecretVault } from "./infrastructure/secret-vault";

const USAGE = `Usage: onyx-cli <command>

  backup [--reason manual|pre-update]   write a consistent copy of the database
  list [--json]                         list the backups, newest first
  verify <name|latest>                  check a backup's integrity and checksum
  restore <name|latest|path> [--force]  replace the database with a backup;
                                        Onyx must be stopped (the current
                                        database is saved first)
  migrate --prisma-dir <dir>            back up the database, apply the
                                        migrations and put the backup back if
                                        they fail (Onyx must be stopped)
  check-claude                          check that CLAUDE_BIN accepts every
                                        option Onyx passes (no request is sent)
`;

class UsageError extends Error {}

function print(text: string): void {
  process.stdout.write(`${text}\n`);
}

function size(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function databasePath(config: AppConfig): string {
  const path = sqliteFilePathFromUrl(config.databaseUrl);
  if (!path) throw new BackupError("DATABASE_URL must point to a database file");
  return path;
}

async function keyFingerprint(config: AppConfig): Promise<string | null> {
  if (config.secrets.key) return SecretVault.fromKey(config.secrets.key).fingerprint();
  const text = await readFile(config.secrets.keyFile, "utf8").catch(() => null);
  if (text === null) return null;
  try {
    return SecretVault.fromKey(text).fingerprint();
  } catch {
    return null;
  }
}

async function onyxIsRunning(config: AppConfig): Promise<boolean> {
  try {
    const response = await fetch(`${config.internalApiUrl}/api/health`, {
      signal: AbortSignal.timeout(1_500),
    });
    return response.ok;
  } catch {
    return false;
  }
}

function option(args: string[], name: string): string | null {
  const index = args.indexOf(name);
  if (index === -1) return null;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new UsageError(`${name} needs a value`);
  return value;
}

async function backup(config: AppConfig, args: string[]): Promise<void> {
  const reason = (option(args, "--reason") ?? "manual") as BackupReason;
  if (!BACKUP_REASONS.includes(reason)) throw new UsageError(`Unknown reason "${reason}"`);
  const manifest = await writeBackup({
    databasePath: databasePath(config),
    dir: config.backup.dir,
    reason,
    keyFingerprint: await keyFingerprint(config),
  });
  const removed = await pruneBackups(config.backup.dir, config.backup.keep);
  print(`Backup written: ${config.backup.dir}/${manifest.file} (${size(manifest.sizeBytes)})`);
  for (const file of removed) print(`Removed old backup ${file}`);
}

async function list(config: AppConfig, args: string[]): Promise<void> {
  const entries = await listBackups(config.backup.dir);
  if (args.includes("--json")) {
    print(
      JSON.stringify(
        entries.map((entry) => ({ ...entry, path: undefined })),
        null,
        2,
      ),
    );
    return;
  }
  if (entries.length === 0) {
    print(`No backup in ${config.backup.dir}`);
    return;
  }
  print(`Backups in ${config.backup.dir}:`);
  for (const entry of entries) {
    const counts = entry.manifest?.counts ?? {};
    print(
      `  ${entry.file.padEnd(36)}  ${size(entry.sizeBytes).padStart(9)}  ${(entry.manifest?.reason ?? "unknown").padEnd(11)}  ${counts["Project"] ?? "?"} projects, ${counts["Task"] ?? "?"} tasks`,
    );
  }
}

async function verify(config: AppConfig, args: string[]): Promise<boolean> {
  const reference = args[0];
  if (!reference) throw new UsageError("verify needs a backup name or latest");
  const path = await resolveBackup(config.backup.dir, reference);
  const result = await verifyBackup(path);
  if (result.ok) {
    print(`${path}: ok (${JSON.stringify(result.inspection.counts)})`);
    return true;
  }
  print(`${path}: damaged`);
  for (const problem of result.problems) print(`  - ${problem}`);
  return false;
}

async function restore(config: AppConfig, args: string[]): Promise<void> {
  const reference = args.find((arg) => !arg.startsWith("--"));
  if (!reference) throw new UsageError("restore needs a backup name, latest or a path");
  if (!args.includes("--force") && (await onyxIsRunning(config)))
    throw new BackupError("Onyx is running: stop it first (onyx-stop), or use onyx restore");
  const backupPath = await resolveBackup(config.backup.dir, reference);
  const result = await restoreDatabase({
    databasePath: databasePath(config),
    backupPath,
    dir: config.backup.dir,
    keyFingerprint: await keyFingerprint(config),
  });
  print(`Restored ${result.restored} into ${databasePath(config)}`);
  print(`  ${JSON.stringify(result.inspection.counts)}`);
  if (result.safety) print(`The previous database was saved as ${result.safety.file}`);
  if (result.keyMatches === false)
    print(
      "Warning: the Claude and GitHub tokens in this backup were sealed with another secret key. Put that secret.key back, or sign in again from Settings.",
    );
}

function runPrisma(directory: string, databaseUrl: string): Promise<boolean> {
  return new Promise((done) => {
    const child = spawn(join(directory, "node_modules", ".bin", "prisma"), ["migrate", "deploy"], {
      cwd: directory,
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: "inherit",
    });
    child.on("error", (error) => {
      process.stderr.write(`error: ${error.message}\n`);
      done(false);
    });
    child.on("exit", (code) => done(code === 0));
  });
}

async function migrate(config: AppConfig, args: string[]): Promise<boolean> {
  const directory = option(args, "--prisma-dir");
  if (!directory) throw new UsageError("migrate needs --prisma-dir <dir>");
  if (await onyxIsRunning(config))
    throw new BackupError("Onyx is running: stop it first (onyx-stop), then migrate");
  const result = await migrateSafely({
    databasePath: databasePath(config),
    backupDir: config.backup.dir,
    keep: config.backup.keep,
    keyFingerprint: await keyFingerprint(config),
    migrate: () => runPrisma(resolve(directory), config.databaseUrl),
  });
  switch (result.status) {
    case "migrated":
      if (result.backup) print(`Backup written before the migration: ${result.backup.file}`);
      print("The database is up to date");
      return true;
    case "failed-fresh":
      print("The migration of the new database failed: nothing to put back");
      return false;
    case "rolled-back":
      print(
        `The migration failed: the database is back as it was before the update (${result.backup.file})`,
      );
      if (result.failedCopy) print(`The half-migrated database was kept as ${result.failedCopy}`);
      return false;
  }
}

async function checkClaude(config: AppConfig): Promise<boolean> {
  const result = await checkCliCompatibility(
    { command: config.claudeBin, args: [] },
    { env: process.env },
  );
  if (result.ok) {
    print(`Claude Code ${result.version ?? "?"} at ${config.claudeBin}: compatible with Onyx`);
    return true;
  }
  print(`Claude Code ${result.version ?? "?"} at ${config.claudeBin}: NOT compatible with Onyx`);
  for (const flag of result.missingFlags) print(`  - missing option ${flag}`);
  for (const mode of result.missingModes) print(`  - missing permission mode ${mode}`);
  for (const command of result.missingCommands) print(`  - missing command ${command}`);
  if (result.error) print(`  - ${result.error}`);
  return false;
}

export async function main(argv: string[]): Promise<number> {
  const [command, ...args] = argv;
  if (!command || command === "-h" || command === "--help" || command === "help") {
    print(USAGE);
    return command ? 0 : 2;
  }
  try {
    const config = loadConfig(process.env);
    switch (command) {
      case "backup":
        await backup(config, args);
        return 0;
      case "list":
        await list(config, args);
        return 0;
      case "verify":
        return (await verify(config, args)) ? 0 : 1;
      case "restore":
        await restore(config, args);
        return 0;
      case "migrate":
        return (await migrate(config, args)) ? 0 : 1;
      case "check-claude":
        return (await checkClaude(config)) ? 0 : 1;
      default:
        throw new UsageError(`Unknown command "${command}"`);
    }
  } catch (error) {
    if (error instanceof UsageError) {
      process.stderr.write(`${error.message}\n\n${USAGE}`);
      return 2;
    }
    process.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

process.exitCode = await main(process.argv.slice(2));
