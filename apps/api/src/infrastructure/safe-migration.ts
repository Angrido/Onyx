import { stat } from "node:fs/promises";
import { join } from "node:path";
import { pruneBackups, restoreDatabase, writeBackup, type BackupManifest } from "./database-backup";

export interface SafeMigrationInput {
  databasePath: string;
  backupDir: string;
  keep: number;
  keyFingerprint: string | null;
  migrate: () => Promise<boolean>;
}

export type SafeMigrationResult =
  | { status: "migrated"; backup: BackupManifest | null }
  | { status: "failed-fresh" }
  | { status: "rolled-back"; backup: BackupManifest; failedCopy: string | null };

export async function migrateSafely(input: SafeMigrationInput): Promise<SafeMigrationResult> {
  const exists = await stat(input.databasePath).then(
    () => true,
    () => false,
  );
  const backup = exists
    ? await writeBackup({
        databasePath: input.databasePath,
        dir: input.backupDir,
        reason: "pre-update",
        keyFingerprint: input.keyFingerprint,
      })
    : null;
  if (backup) await pruneBackups(input.backupDir, input.keep);
  if (await input.migrate()) return { status: "migrated", backup };
  if (!backup) return { status: "failed-fresh" };
  const restored = await restoreDatabase({
    databasePath: input.databasePath,
    backupPath: join(input.backupDir, backup.file),
    dir: input.backupDir,
    keyFingerprint: input.keyFingerprint,
  });
  return { status: "rolled-back", backup, failedCopy: restored.safety?.file ?? null };
}
