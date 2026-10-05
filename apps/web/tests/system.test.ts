import type { DiagnosticsBundle, HealthCheckDto } from "@onyx/contracts";
import { describe, expect, it } from "vitest";
import { translator } from "@/lib/i18n/core";
import {
  checkCounts,
  checksSummary,
  contextText,
  DEFAULT_LOG_FILTER,
  diagnosticsFacts,
  diagnosticsFileName,
  formatLogTime,
  logsPath,
  otherReasons,
} from "@/lib/system";

const CHECKS: HealthCheckDto[] = [
  { id: "index", level: "OK", reason: "Indexed 1 day ago" },
  { id: "git", level: "ATTENTION", reason: "2 commits behind origin/main" },
  { id: "tests", level: "ATTENTION", reason: "pnpm test cannot run" },
  { id: "disk", level: "ERROR", reason: "Almost no space left" },
  { id: "claude", level: "OK", reason: "Claude account connected" },
];

describe("health checks", () => {
  it("counts the levels", () => {
    expect(checkCounts(CHECKS)).toEqual({ OK: 2, ATTENTION: 2, ERROR: 1 });
  });

  it("sums them up in words", () => {
    expect(checksSummary(CHECKS)).toBe("1 error · 2 warnings");
    expect(checksSummary(CHECKS.filter((check) => check.level !== "ERROR"))).toBe("2 warnings");
    expect(checksSummary(CHECKS.filter((check) => check.level === "OK"))).toBe("All checks passed");
    expect(checksSummary([])).toBe("No checks yet");
    expect(checksSummary(CHECKS, translator("it"))).toBe("1 errore · 2 avvisi");
  });

  it("keeps only the reasons the checks do not already show", () => {
    expect(
      otherReasons({
        checks: CHECKS,
        reasons: ["Almost no space left", "The last run failed", "2 commits behind origin/main"],
      }),
    ).toEqual(["The last run failed"]);
  });
});

describe("logs", () => {
  it("builds the query string", () => {
    expect(logsPath(DEFAULT_LOG_FILTER)).toBe("/api/logs?limit=500");
    expect(logsPath({ level: "warn", runId: " run-1 ", q: " push failed " }, 50)).toBe(
      "/api/logs?level=warn&runId=run-1&q=push+failed&limit=50",
    );
    expect(logsPath({ level: "all", runId: "", q: "x".repeat(300) })).toContain(
      `q=${"x".repeat(200)}&`,
    );
  });

  it("shows only the time for today and the day for older lines", () => {
    const now = new Date(2026, 9, 4, 18, 0, 0);
    const today = new Date(2026, 9, 4, 9, 5, 7).toISOString();
    const older = new Date(2026, 9, 2, 9, 5, 7).toISOString();
    expect(formatLogTime(today, now, "en")).toBe("09:05:07");
    expect(formatLogTime(older, now, "en")).toBe("2 Oct 09:05:07");
    expect(formatLogTime(older, now, "it")).toBe("2 ott 09:05:07");
    expect(formatLogTime("not a date", now)).toBe("not a date");
  });

  it("prints the context without the run id", () => {
    expect(contextText({ context: { runId: "r" } })).toBeNull();
    expect(contextText({ context: { runId: "r", projectId: "p" } })).toBe(
      '{\n  "projectId": "p"\n}',
    );
  });
});

describe("diagnostics", () => {
  const bundle: DiagnosticsBundle = {
    format: 1,
    generatedAt: "2026-10-04T09:08:07.123Z",
    onyx: { version: "0.1.0", commit: "abc1234", uptimeSec: 10 },
    runtime: {
      node: "v22.0.0",
      platform: "linux",
      release: "6.1",
      arch: "x64",
      cpus: 4,
      memoryBytes: 8,
    },
    claude: { version: "2.1.0", compatible: false, missing: ["--settings"], error: null },
    config: {},
    secrets: { ANTHROPIC_API_KEY: "set", ONYX_GITHUB_TOKEN: "not set" },
    readiness: {
      ready: false,
      checks: [
        { name: "database", ok: true, detail: null },
        { name: "claude-cli", ok: false, detail: "missing" },
      ],
      cliVersion: "2.1.0",
    },
    recovery: null,
    logs: { capacity: 2000, buffered: 3, recent: [] },
    database: {
      fileBytes: 2048,
      walBytes: null,
      migrations: 3,
      lastMigration: "x",
      tables: [
        { table: "Project", rows: 2 },
        { table: "Task", rows: 5 },
        { table: "Gone", rows: null },
      ],
      error: null,
    },
    queue: {
      running: 1,
      queued: 2,
      maxConcurrent: 2,
      reservedSlots: 0,
      waiting: {},
      projectLimit: null,
    },
    disk: [
      { name: "data", path: "/d", freeBytes: 500, totalBytes: 1000, freeRatio: 0.5, error: null },
      {
        name: "projects",
        path: "/p",
        freeBytes: 100,
        totalBytes: 1000,
        freeRatio: 0.1,
        error: null,
      },
    ],
  };

  it("sums up the bundle for the preview", () => {
    const facts = Object.fromEntries(
      diagnosticsFacts(bundle).map((fact) => [fact.label, fact.value]),
    );
    expect(facts).toMatchObject({
      Onyx: "0.1.0 · abc1234",
      "Claude Code": "2.1.0 (not compatible)",
      Readiness: "Not ready: claude-cli",
      Database: "2.0 KB · 7 rows · 3 migrations",
      Queue: "1 running · 2 queued",
      "Disk space": "100 B free in projects",
      Secrets: "1 set, values left out",
    });
  });

  it("names the file after the moment it was made", () => {
    expect(diagnosticsFileName(bundle.generatedAt)).toBe("onyx-diagnostics-20261004-090807.json");
  });
});
