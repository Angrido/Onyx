import type {
  DiagnosticsBundle,
  HealthCheckDto,
  HealthCheckId,
  LogEntryDto,
  LogLevel,
  MissionProjectDto,
  ProjectHealth,
} from "@onyx/contracts";
import { formatBytes } from "@/lib/format";
import { english, msg, type Locale, type Translate } from "@/lib/i18n/core";

export const HEALTH_CHECK_LABELS: Record<HealthCheckId, string> = {
  index: msg("Code index"),
  git: msg("Git"),
  tests: msg("Test runner"),
  disk: msg("Disk space"),
  credentials: msg("Credentials"),
};

export const HEALTH_LEVEL_LABELS: Record<ProjectHealth, string> = {
  OK: msg("OK"),
  ATTENTION: msg("Warning"),
  ERROR: msg("Error"),
};

export function otherReasons(project: Pick<MissionProjectDto, "reasons" | "checks">): string[] {
  const fromChecks = new Set(project.checks.map((check) => check.reason));
  return project.reasons.filter((reason) => !fromChecks.has(reason));
}

export function checkCounts(checks: readonly HealthCheckDto[]): Record<ProjectHealth, number> {
  const counts: Record<ProjectHealth, number> = { OK: 0, ATTENTION: 0, ERROR: 0 };
  for (const check of checks) counts[check.level] += 1;
  return counts;
}

export function checksSummary(checks: readonly HealthCheckDto[], t: Translate = english): string {
  const counts = checkCounts(checks);
  if (checks.length === 0) return t("No checks yet");
  if (counts.ERROR === 0 && counts.ATTENTION === 0) return t("All checks passed");
  const parts: string[] = [];
  if (counts.ERROR > 0)
    parts.push(counts.ERROR === 1 ? t("1 error") : t("{count} errors", { count: counts.ERROR }));
  if (counts.ATTENTION > 0)
    parts.push(
      counts.ATTENTION === 1 ? t("1 warning") : t("{count} warnings", { count: counts.ATTENTION }),
    );
  return parts.join(" · ");
}

export const LOG_LEVEL_FILTERS = ["all", "debug", "info", "warn", "error"] as const;
export type LogLevelFilter = (typeof LOG_LEVEL_FILTERS)[number];

export const LOG_LEVEL_FILTER_LABELS: Record<LogLevelFilter, string> = {
  all: msg("All levels"),
  debug: msg("Debug and above"),
  info: msg("Info and above"),
  warn: msg("Warnings and errors"),
  error: msg("Errors only"),
};

export const LOG_LEVEL_TONES: Record<LogLevel, "neutral" | "primary" | "warning" | "danger"> = {
  trace: "neutral",
  debug: "neutral",
  info: "primary",
  warn: "warning",
  error: "danger",
  fatal: "danger",
};

export const LOG_PAGE_SIZE = 500;

export interface LogFilterState {
  level: LogLevelFilter;
  runId: string;
  q: string;
}

export const DEFAULT_LOG_FILTER: LogFilterState = { level: "all", runId: "", q: "" };

export function logsPath(filter: LogFilterState, limit: number = LOG_PAGE_SIZE): string {
  const params = new URLSearchParams();
  if (filter.level !== "all") params.set("level", filter.level);
  const runId = filter.runId.trim();
  if (runId) params.set("runId", runId);
  const q = filter.q.trim();
  if (q) params.set("q", q.slice(0, 200));
  params.set("limit", String(limit));
  return `/api/logs?${params.toString()}`;
}

const TIME_FORMATS: Record<Locale, Intl.DateTimeFormat> = {
  it: new Intl.DateTimeFormat("it-IT", { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
  en: new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
};

const DAY_FORMATS: Record<Locale, Intl.DateTimeFormat> = {
  it: new Intl.DateTimeFormat("it-IT", { day: "numeric", month: "short" }),
  en: new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }),
};

export function formatLogTime(iso: string, now: Date = new Date(), locale: Locale = "en"): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const time = TIME_FORMATS[locale].format(date);
  return date.toDateString() === now.toDateString()
    ? time
    : `${DAY_FORMATS[locale].format(date)} ${time}`;
}

export function contextText(entry: Pick<LogEntryDto, "context">): string | null {
  const rest = Object.fromEntries(Object.entries(entry.context).filter(([key]) => key !== "runId"));
  return Object.keys(rest).length === 0 ? null : JSON.stringify(rest, null, 2);
}

export interface DiagnosticsFact {
  label: string;
  value: string;
}

export function diagnosticsFacts(
  bundle: DiagnosticsBundle,
  t: Translate = english,
): DiagnosticsFact[] {
  const onyx = [bundle.onyx.version, bundle.onyx.commit].filter(Boolean).join(" · ");
  const claude =
    bundle.claude.version === null
      ? t("Not found")
      : bundle.claude.compatible === false
        ? t("{version} (not compatible)", { version: bundle.claude.version })
        : bundle.claude.version;
  const failed = bundle.readiness.checks.filter((check) => !check.ok).map((check) => check.name);
  const rows = bundle.database.tables
    .filter((table) => table.rows !== null)
    .reduce((total, table) => total + (table.rows ?? 0), 0);
  const tightest = [...bundle.disk]
    .filter((disk) => disk.freeBytes !== null)
    .sort((left, right) => (left.freeRatio ?? 1) - (right.freeRatio ?? 1))[0];
  const secrets = Object.values(bundle.secrets).filter((value) => value === "set").length;
  return [
    { label: "Onyx", value: onyx || t("Unknown") },
    { label: "Node.js", value: bundle.runtime.node },
    { label: t("System"), value: `${bundle.runtime.platform} ${bundle.runtime.release}` },
    { label: "Claude Code", value: claude },
    {
      label: t("Readiness"),
      value: bundle.readiness.ready
        ? t("Ready")
        : t("Not ready: {checks}", { checks: failed.join(", ") || "?" }),
    },
    {
      label: t("Database"),
      value: t("{size} · {rows} rows · {count} migrations", {
        size: bundle.database.fileBytes === null ? "?" : formatBytes(bundle.database.fileBytes),
        rows: rows,
        count: bundle.database.migrations,
      }),
    },
    {
      label: t("Queue"),
      value: t("{running} running · {queued} queued", {
        running: bundle.queue.running,
        queued: bundle.queue.queued,
      }),
    },
    {
      label: t("Disk space"),
      value:
        tightest && tightest.freeBytes !== null
          ? t("{free} free in {name}", {
              free: formatBytes(tightest.freeBytes),
              name: tightest.name,
            })
          : t("Unknown"),
    },
    {
      label: t("Recent warnings and errors"),
      value: String(bundle.logs.recent.length),
    },
    {
      label: t("Secrets"),
      value: t("{count} set, values left out", { count: secrets }),
    },
  ];
}

export function diagnosticsFileName(iso: string): string {
  const stamp = iso
    .replace(/\.\d+Z$/, "")
    .replace(/Z$/, "")
    .replace(/[-:]/g, "")
    .replace("T", "-");
  return `onyx-diagnostics-${stamp}.json`;
}
