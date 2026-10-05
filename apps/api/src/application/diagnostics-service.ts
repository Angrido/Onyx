import { stat, statfs } from "node:fs/promises";
import { arch, cpus, platform, release, totalmem } from "node:os";
import { resolve } from "node:path";
import type { CliCompatibility } from "@onyx/agent-runtime";
import type { DiagnosticsBundle, DiskUsage, QueueDto, ReadyResponse } from "@onyx/contracts";
import type { PrismaClient } from "@onyx/db";
import type { AppConfig } from "../config";
import { redactText, redactValue } from "../domain/redaction";
import { readBuildInfo, type BuildInfo } from "../infrastructure/build-info";
import type { LogBuffer } from "../infrastructure/log-buffer";
import { folderSpace, type FolderSpace } from "./health-service";

export const DIAGNOSTICS_LOG_LIMIT = 200;

export const COUNTED_TABLES = [
  "Project",
  "Workspace",
  "Task",
  "AgentRun",
  "AgentEvent",
  "Session",
  "TokenLog",
  "TddLoop",
  "Orchestration",
  "Approval",
  "ProjectFact",
  "PullRequest",
  "AuditLog",
  "FileNode",
] as const;

export type RecoverySummary = Record<string, string | number | boolean | null | string[]>;

export interface DiagnosticsDeps {
  config: AppConfig;
  prisma: PrismaClient;
  logs: LogBuffer;
  readiness: () => Promise<ReadyResponse>;
  cliVersion: () => string | null;
  cliCompatibility: () => CliCompatibility | null;
  queue: () => Promise<QueueDto>;
  secrets: () => Promise<Record<string, boolean>>;
  recovery?: () => RecoverySummary | null;
  buildInfo?: () => Promise<BuildInfo>;
  statfs?: (path: string) => Promise<FolderSpace>;
  now?: () => Date;
}

function databaseFile(url: string): string | null {
  if (!url.startsWith("file:")) return null;
  const path = url.slice("file:".length).split("?")[0] ?? "";
  return path.length > 0 ? resolve(path) : null;
}

async function sizeOf(path: string | null): Promise<number | null> {
  if (path === null) return null;
  try {
    return (await stat(path)).size;
  } catch {
    return null;
  }
}

function errorText(error: unknown): string {
  return redactText(error instanceof Error ? error.message : String(error));
}

export function safeConfig(config: AppConfig): Record<string, unknown> {
  return {
    env: config.env,
    logLevel: config.logLevel,
    host: config.host,
    port: config.port,
    databaseFile: databaseFile(config.databaseUrl),
    dataDir: config.dataDir,
    projectsDir: config.projectsDir,
    runtimeDir: config.runtimeDir,
    worktreesDir: config.worktreesDir,
    allowedProjectRoots: config.allowedProjectRoots,
    allowedOrigins: config.allowedOrigins,
    publicOrigin: config.publicOrigin,
    childEnvPassthrough: config.childEnvPassthrough,
    cookieSecure: config.cookieSecure,
    sessionTtlHours: Math.round(config.sessionTtlMs / 3_600_000),
    maxConcurrentAgents: config.maxConcurrentAgents,
    escalationGraceMs: config.escalationGraceMs,
    autoResumeQueued: config.autoResumeQueued,
    claudeBin: config.claudeBin,
    claudeLogin: config.credentials.kind,
    context: {
      enabled: config.context.enabled,
      packBudgetTokens: config.context.packBudgetTokens,
      mapBudgetTokens: config.context.mapBudgetTokens,
      indexWaitMs: config.context.indexWaitMs,
      promptCacheTtlMs: config.context.promptCacheTtlMs,
      mcpServer: config.context.mcpServerPath !== null,
    },
    terminal: {
      idleMs: config.terminal.idleMs,
      statusLine: config.terminal.statusLinePath !== null,
    },
    githubApiUrl: config.github.apiUrl,
    internalApiUrl: config.internalApiUrl,
    agentSandbox: config.agentSandbox
      ? { user: config.agentSandbox.user, group: config.agentSandbox.group }
      : null,
    keyFile: config.secrets.keyFile,
    backup: {
      dir: config.backup.dir,
      keep: config.backup.keep,
      intervalHours: config.backup.intervalHours,
    },
    agentProtectedPaths: config.agentProtectedPaths.length,
  };
}

export class DiagnosticsService {
  private build: Promise<BuildInfo> | null = null;

  constructor(private readonly deps: DiagnosticsDeps) {}

  async bundle(): Promise<DiagnosticsBundle> {
    const now = this.deps.now?.() ?? new Date();
    this.build ??= (this.deps.buildInfo ?? (() => readBuildInfo()))().catch(() => ({
      version: null,
      commit: null,
    }));
    const [build, readiness, database, queue, disk, secrets] = await Promise.all([
      this.build,
      this.deps.readiness().catch((error: unknown): ReadyResponse => ({
        ready: false,
        checks: [{ name: "readiness", ok: false, detail: errorText(error) }],
        cliVersion: this.deps.cliVersion(),
      })),
      this.database(),
      this.queue(),
      this.disks(),
      this.secretFlags(),
    ]);
    const compatibility = this.deps.cliCompatibility();
    const recent = this.deps.logs.query({ level: "warn", limit: DIAGNOSTICS_LOG_LIMIT });
    const body: Omit<DiagnosticsBundle, "secrets"> = {
      format: 1,
      generatedAt: now.toISOString(),
      onyx: {
        version: build.version,
        commit: build.commit,
        uptimeSec: Math.round(process.uptime()),
      },
      runtime: {
        node: process.version,
        platform: platform(),
        release: release(),
        arch: arch(),
        cpus: cpus().length,
        memoryBytes: totalmem(),
      },
      claude: {
        version: this.deps.cliVersion(),
        compatible: compatibility ? compatibility.ok : null,
        missing: compatibility
          ? [
              ...compatibility.missingFlags,
              ...compatibility.missingModes.map((mode) => `permission mode ${mode}`),
              ...compatibility.missingCommands.map((command) => `command ${command}`),
            ]
          : [],
        error: compatibility?.error ?? null,
      },
      config: safeConfig(this.deps.config),
      readiness,
      recovery: this.deps.recovery?.() ?? null,
      logs: {
        capacity: this.deps.logs.capacity,
        buffered: this.deps.logs.buffered,
        recent: recent.entries,
      },
      database,
      queue,
      disk,
    };
    return { ...redactValue(body), secrets };
  }

  private async secretFlags(): Promise<Record<string, "set" | "not set">> {
    const flags = await this.deps.secrets().catch(() => ({}) as Record<string, boolean>);
    return Object.fromEntries(
      Object.entries(flags).map(([name, set]) => [name, set ? "set" : "not set"]),
    );
  }

  private async database(): Promise<DiagnosticsBundle["database"]> {
    const file = databaseFile(this.deps.config.databaseUrl);
    const [fileBytes, walBytes] = await Promise.all([
      sizeOf(file),
      sizeOf(file === null ? null : `${file}-wal`),
    ]);
    try {
      const existing = new Set(
        (
          await this.deps.prisma.$queryRawUnsafe<{ name: string }[]>(
            "SELECT name FROM sqlite_master WHERE type = 'table'",
          )
        ).map((row) => row.name),
      );
      const tables: DiagnosticsBundle["database"]["tables"] = [];
      for (const table of COUNTED_TABLES) {
        if (!existing.has(table)) {
          tables.push({ table, rows: null });
          continue;
        }
        const [row] = await this.deps.prisma.$queryRawUnsafe<{ total: bigint | number }[]>(
          `SELECT COUNT(*) AS total FROM "${table}"`,
        );
        tables.push({ table, rows: row ? Number(row.total) : null });
      }
      const migrations = existing.has("_prisma_migrations")
        ? await this.deps.prisma.$queryRawUnsafe<{ migration_name: string }[]>(
            "SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name",
          )
        : [];
      return {
        fileBytes,
        walBytes,
        migrations: migrations.length,
        lastMigration: migrations.at(-1)?.migration_name ?? null,
        tables,
        error: null,
      };
    } catch (error) {
      return {
        fileBytes,
        walBytes,
        migrations: 0,
        lastMigration: null,
        tables: [],
        error: errorText(error),
      };
    }
  }

  private async queue(): Promise<DiagnosticsBundle["queue"]> {
    try {
      const queue = await this.deps.queue();
      const waiting: Record<string, number> = {};
      for (const item of queue.items) {
        const reason = item.waiting ?? "READY";
        waiting[reason] = (waiting[reason] ?? 0) + 1;
      }
      return {
        running: queue.active.length,
        queued: queue.items.length,
        maxConcurrent: queue.maxConcurrent,
        reservedSlots: queue.reservedSlots,
        waiting,
        projectLimit: queue.settings.projectLimit,
      };
    } catch {
      return {
        running: 0,
        queued: 0,
        maxConcurrent: this.deps.config.maxConcurrentAgents,
        reservedSlots: 0,
        waiting: {},
        projectLimit: null,
      };
    }
  }

  private async disks(): Promise<DiskUsage[]> {
    const read = this.deps.statfs ?? ((path: string) => statfs(path));
    const folders: [string, string][] = [
      ["data", this.deps.config.dataDir],
      ["projects", this.deps.config.projectsDir],
      ["backups", this.deps.config.backup.dir],
    ];
    return Promise.all(
      folders.map(async ([name, path]) => {
        const facts = await folderSpace(path, read);
        return {
          name,
          path,
          freeBytes: facts.freeBytes,
          totalBytes: facts.totalBytes,
          freeRatio:
            facts.freeBytes !== null && facts.totalBytes
              ? Math.round((facts.freeBytes / facts.totalBytes) * 1000) / 1000
              : null,
          error: facts.error,
        };
      }),
    );
  }
}

export function diagnosticsFileName(now: Date): string {
  const stamp = now
    .toISOString()
    .replace(/\.\d+Z$/, "")
    .replace(/[-:]/g, "")
    .replace("T", "-");
  return `onyx-diagnostics-${stamp}.json`;
}
