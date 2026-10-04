import type { GitSummary } from "@onyx/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { projectHealth } from "../../src/domain/mission";
import { quotaNotice, runMessage } from "../../src/domain/notifications";
import { DEFAULT_QUOTA_SETTINGS, quotaMessage, type QuotaWindow } from "../../src/domain/quota";
import { rememberLocale, runWithLocale } from "../../src/i18n";

const NOW = new Date("2026-10-04T12:00:00.000Z");

const WINDOW: QuotaWindow = {
  type: "five_hour",
  status: "allowed",
  utilization: 0.93,
  resetsAt: new Date(NOW.getTime() + 3_600_000),
  observedAt: NOW,
};

const GIT: GitSummary = {
  isRepo: true,
  branch: "main",
  upstream: "origin/main",
  ahead: 0,
  behind: 3,
  changeCount: 0,
  checkedAt: "2026-10-04T10:00:00.000Z",
  error: null,
};

const holding = () => quotaMessage("HOLDING", [WINDOW], DEFAULT_QUOTA_SETTINGS, NOW, 2);

const blocked = () =>
  runMessage({
    runId: "run-1",
    taskTitle: "Fix login",
    projectName: "Onyx",
    status: "COMPLETED",
    costUsd: null,
    blockedCommands: 1,
  });

const health = () =>
  projectHealth({
    indexError: null,
    git: GIT,
    lastRun: { status: "FAILED" },
    lastTdd: null,
    pendingApprovals: 1,
  }).reasons;

describe("status texts", () => {
  afterEach(() => rememberLocale("en"));

  it("renders the subscription limit messages in Italian", () => {
    expect(runWithLocale("it", holding)).toBe(
      "Quasi al limite: finestra di 5 ore (93% usato). 2 task che possono aspettare sono trattenuti finché non si azzera.",
    );
    expect(runWithLocale("it", () => quotaNotice("OK", "LIMITED", "x")?.title)).toBe(
      "Limiti di Claude raggiunti",
    );
  });

  it("renders notifications and project health in Italian", () => {
    expect(runWithLocale("it", blocked)).toMatchObject({
      title: "Ti aspetta · Fix login",
      body: "Onyx: Fix login. L'agente non ha potuto eseguire 1 comando: consentilo per continuare.",
    });
    expect(runWithLocale("it", health)).toEqual([
      "L'ultima run è fallita",
      "1 approvazione in attesa",
      "3 commit indietro rispetto a origin/main",
    ]);
  });

  it("keeps the English texts unchanged", () => {
    expect(runWithLocale("en", holding)).toBe(
      "Almost at the 5-hour window (93% used): 2 tasks that can wait are held until it resets.",
    );
    expect(runWithLocale("en", blocked)).toMatchObject({
      title: "Waiting for you · Fix login",
      body: "Onyx: Fix login. The agent was not allowed to run 1 command: allow them to continue.",
    });
    expect(runWithLocale("en", health)).toEqual([
      "The last run failed",
      "1 approval waiting",
      "3 commits behind origin/main",
    ]);
  });

  it("uses the last language seen outside a request", () => {
    rememberLocale("it");
    expect(holding()).toContain("Quasi al limite");
  });
});
