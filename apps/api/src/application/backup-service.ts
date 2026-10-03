import { join } from "node:path";
import type { BackupDto, BackupListResponse, BackupVerifyResult } from "@onyx/contracts";
import { sqliteFilePathFromUrl, type PrismaClient } from "@onyx/db";
import type { Logger } from "pino";
import type { AppConfig } from "../config";
import { badRequest, conflict, notFound } from "../errors";
import {
  isBackupFileName,
  listBackups,
  pruneBackups,
  verifyBackup,
  writeBackup,
  type BackupEntry,
  type BackupManifest,
  type BackupReason,
} from "../infrastructure/database-backup";

const HOUR_MS = 3_600_000;
const FIRST_CHECK_DELAY_MS = 5 * 60_000;
const CHECK_EVERY_MS = HOUR_MS;

export interface BackupServiceDeps {
  prisma: PrismaClient;
  logger: Logger;
  config: Pick<AppConfig, "databaseUrl" | "backup">;
  keyFingerprint: string | null;
  now?: () => Date;
  firstCheckDelayMs?: number;
}

export class BackupService {
  private running: Promise<BackupManifest> | null = null;
  private timers: NodeJS.Timeout[] = [];

  constructor(private readonly deps: BackupServiceDeps) {}

  get databasePath(): string {
    const path = sqliteFilePathFromUrl(this.deps.config.databaseUrl);
    if (!path) throw badRequest("Backups need a database file");
    return path;
  }

  async list(): Promise<BackupListResponse> {
    const entries = await listBackups(this.deps.config.backup.dir);
    const last = entries.find((entry) => entry.manifest?.reason !== "pre-restore") ?? null;
    const interval = this.deps.config.backup.intervalHours;
    return {
      items: entries.map((entry) => this.toDto(entry)),
      dir: this.deps.config.backup.dir,
      keep: this.deps.config.backup.keep,
      intervalHours: interval,
      lastBackupAt: last?.createdAt ?? null,
      nextBackupAt:
        interval > 0
          ? new Date(
              Math.max(
                this.now().getTime(),
                (last ? new Date(last.createdAt).getTime() : 0) + interval * HOUR_MS,
              ),
            ).toISOString()
          : null,
      running: this.running !== null,
    };
  }

  async create(reason: BackupReason, actor: string): Promise<BackupDto> {
    if (this.running) throw conflict("A backup is already being written");
    const run = writeBackup({
      databasePath: this.databasePath,
      dir: this.deps.config.backup.dir,
      reason,
      keyFingerprint: this.deps.keyFingerprint,
      now: this.now(),
    });
    this.running = run;
    try {
      const manifest = await run;
      const removed = await pruneBackups(this.deps.config.backup.dir, this.deps.config.backup.keep);
      this.deps.logger.info(
        { file: manifest.file, reason, sizeBytes: manifest.sizeBytes, removed },
        "Backup written",
      );
      await this.audit(actor, "backup.created", manifest.file, { reason });
      const entry = (await listBackups(this.deps.config.backup.dir)).find(
        (item) => item.file === manifest.file,
      );
      if (!entry) throw notFound("Backup");
      return this.toDto(entry);
    } finally {
      this.running = null;
    }
  }

  async verify(name: string): Promise<BackupVerifyResult> {
    const path = this.pathOf(name);
    const result = await verifyBackup(path);
    if (result.problems.some((problem) => problem.includes("unable to open")))
      throw notFound("Backup");
    return { name, ok: result.ok, problems: result.problems, counts: result.inspection.counts };
  }

  pathOf(name: string): string {
    if (!isBackupFileName(name)) throw badRequest("Unknown backup name");
    return join(this.deps.config.backup.dir, name);
  }

  async exists(name: string): Promise<boolean> {
    const entries = await listBackups(this.deps.config.backup.dir);
    return entries.some((entry) => entry.file === name);
  }

  start(): void {
    if (this.deps.config.backup.intervalHours <= 0) return;
    const first = setTimeout(
      () => void this.tick(),
      this.deps.firstCheckDelayMs ?? FIRST_CHECK_DELAY_MS,
    );
    const every = setInterval(() => void this.tick(), CHECK_EVERY_MS);
    first.unref();
    every.unref();
    this.timers.push(first, every);
  }

  async stop(): Promise<void> {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers = [];
    await this.running?.catch(() => undefined);
  }

  async tick(): Promise<boolean> {
    if (this.running) return false;
    const listing = await this.list();
    const due =
      listing.lastBackupAt === null ||
      this.now().getTime() - new Date(listing.lastBackupAt).getTime() >=
        this.deps.config.backup.intervalHours * HOUR_MS;
    if (!due) return false;
    try {
      await this.create("scheduled", "system");
      return true;
    } catch (error) {
      this.deps.logger.error({ err: error }, "Scheduled backup failed");
      return false;
    }
  }

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  private toDto(entry: BackupEntry): BackupDto {
    const manifest = entry.manifest;
    return {
      name: entry.file,
      createdAt: entry.createdAt,
      reason: manifest?.reason ?? null,
      sizeBytes: entry.sizeBytes,
      sha256: manifest?.sha256 ?? null,
      migrations: manifest?.migrations.length ?? 0,
      counts: manifest?.counts ?? {},
      keyMatches:
        manifest?.keyFingerprint && this.deps.keyFingerprint
          ? manifest.keyFingerprint === this.deps.keyFingerprint
          : null,
    };
  }

  private async audit(actor: string, action: string, target: string, meta: object): Promise<void> {
    await this.deps.prisma.auditLog
      .create({ data: { actor, action, target, meta: { ...meta } } })
      .catch(() => undefined);
  }
}
