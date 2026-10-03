import type { ProcessExit } from "@onyx/agent-runtime";
import type { RunItemOf } from "@onyx/contracts";
import { describe, expect, it } from "vitest";
import { resolveRunOutcome } from "../../src/domain/run-outcome";
import { decideSession, type ActiveSessionView } from "../../src/domain/session-policy";
import { canTransition, isRunnable } from "../../src/domain/task-state";

function exit(overrides: Partial<ProcessExit> = {}): ProcessExit {
  return {
    reason: "completed",
    exitCode: 0,
    signal: null,
    sawInit: true,
    sawResult: true,
    stderrTail: "",
    error: null,
    ...overrides,
  };
}

function result(subtype: string, isError: boolean): RunItemOf<"result"> {
  return {
    kind: "result",
    subtype,
    isError,
    numTurns: 1,
    durationMs: 10,
    durationApiMs: 8,
    costUsd: 0.01,
    usage: { inputTokens: 1, outputTokens: 1, cacheCreationTokens: 0, cacheReadTokens: 0 },
    resultText: "ok",
    sessionId: "s",
    modelUsage: {},
  };
}

describe("resolveRunOutcome", () => {
  it("completes on a successful result", () => {
    expect(resolveRunOutcome(exit(), result("success", false))).toEqual({
      runStatus: "COMPLETED",
      taskStatus: "COMPLETED",
      errorMessage: null,
    });
  });

  it("fails on error results", () => {
    expect(resolveRunOutcome(exit(), result("error_max_turns", true))).toMatchObject({
      runStatus: "FAILED",
      errorMessage: "Claude Code finished with error_max_turns",
    });
  });

  it("maps operator aborts and shutdowns", () => {
    expect(resolveRunOutcome(exit({ reason: "aborted" }), null).runStatus).toBe("ABORTED");
    expect(resolveRunOutcome(exit({ reason: "shutdown" }), null)).toMatchObject({
      runStatus: "INTERRUPTED",
      taskStatus: "INTERRUPTED",
    });
  });

  it("maps timeouts", () => {
    expect(resolveRunOutcome(exit({ reason: "idle_timeout" }), null)).toMatchObject({
      runStatus: "TIMEOUT",
      taskStatus: "FAILED",
    });
  });

  it("explains crashes using the stderr tail", () => {
    const outcome = resolveRunOutcome(
      exit({ exitCode: 3, sawResult: false, stderrTail: "boot\nfatal: simulated crash\n" }),
      null,
    );
    expect(outcome.errorMessage).toBe(
      "Claude Code exited without a result (exit code 3): fatal: simulated crash",
    );
  });

  it("reports spawn failures", () => {
    expect(
      resolveRunOutcome(exit({ reason: "spawn_error", error: "spawn claude ENOENT" }), null)
        .errorMessage,
    ).toContain("ENOENT");
  });
});

describe("decideSession", () => {
  const active: ActiveSessionView = {
    id: "s1",
    modelId: "claude-sonnet-5-5",
    status: "IDLE",
    contextTokens: 1_000,
    established: true,
  };
  const request = { modelId: "claude-sonnet-5-5", forceNew: false, maxSessionTokens: 150_000 };

  it("resumes a healthy session with the same model", () => {
    expect(decideSession(active, request)).toEqual({ action: "resume", sessionId: "s1" });
  });

  it("starts fresh when there is no usable session", () => {
    expect(decideSession(null, request)).toEqual({ action: "start", rotate: null });
    expect(decideSession({ ...active, status: "CLOSED" }, request)).toEqual({
      action: "start",
      rotate: null,
    });
  });

  it.each([
    [{ forceNew: true }, {}, "MANUAL_RESET"],
    [{ modelId: "claude-opus-5-5" }, {}, "MODEL_CHANGE"],
    [{}, { contextTokens: 200_000 }, "CONTEXT_PRESSURE"],
    [{}, { established: false }, "ERROR"],
  ] as const)("rotates %o / %o with %s", (requestOverride, sessionOverride, reason) => {
    expect(
      decideSession({ ...active, ...sessionOverride }, { ...request, ...requestOverride }),
    ).toEqual({ action: "start", rotate: { sessionId: "s1", reason } });
  });
});

describe("task state machine", () => {
  it("allows reruns of finished tasks only", () => {
    expect(isRunnable("DRAFT")).toBe(true);
    expect(isRunnable("COMPLETED")).toBe(true);
    expect(isRunnable("RUNNING")).toBe(false);
    expect(isRunnable("QUEUED")).toBe(false);
  });

  it("guards transitions", () => {
    expect(canTransition("QUEUED", "RUNNING")).toBe(true);
    expect(canTransition("DRAFT", "COMPLETED")).toBe(false);
  });
});
