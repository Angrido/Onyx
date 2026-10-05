import type { ProcessExit } from "@onyx/agent-runtime";
import type { RunItemOf, RunStatus, TaskStatus } from "@onyx/contracts";
import { interpolate } from "../i18n";
import { RUN_TEXT } from "./run-texts";

export interface RunOutcome {
  runStatus: RunStatus;
  taskStatus: TaskStatus;
  errorMessage: string | null;
}

const TIMEOUT_MESSAGES = {
  wall_clock_timeout: RUN_TEXT.wallClock,
  idle_timeout: RUN_TEXT.idle,
  init_timeout: RUN_TEXT.init,
} as const;

function lastLine(text: string): string | null {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return lines.at(-1) ?? null;
}

export function resolveRunOutcome(
  exit: ProcessExit,
  result: RunItemOf<"result"> | null,
): RunOutcome {
  switch (exit.reason) {
    case "aborted":
      return { runStatus: "ABORTED", taskStatus: "CANCELLED", errorMessage: RUN_TEXT.aborted };
    case "shutdown":
      return {
        runStatus: "INTERRUPTED",
        taskStatus: "INTERRUPTED",
        errorMessage: RUN_TEXT.shutdown,
      };
    case "wall_clock_timeout":
    case "idle_timeout":
    case "init_timeout":
      return {
        runStatus: "TIMEOUT",
        taskStatus: "FAILED",
        errorMessage: TIMEOUT_MESSAGES[exit.reason],
      };
    case "spawn_error":
      return {
        runStatus: "FAILED",
        taskStatus: "FAILED",
        errorMessage: interpolate(RUN_TEXT.spawn, { error: exit.error ?? RUN_TEXT.unknownError }),
      };
    case "completed":
      break;
  }

  if (result) {
    if (result.subtype === "success" && !result.isError) {
      return { runStatus: "COMPLETED", taskStatus: "COMPLETED", errorMessage: null };
    }
    if (result.subtype === "aborted") {
      return {
        runStatus: "ABORTED",
        taskStatus: "CANCELLED",
        errorMessage: RUN_TEXT.claudeAborted,
      };
    }
    const reported = result.subtype === "success" ? lastLine(result.resultText ?? "") : null;
    const cause = result.errors?.[0] ?? null;
    return {
      runStatus: "FAILED",
      taskStatus: "FAILED",
      errorMessage: reported
        ? interpolate(RUN_TEXT.reported, { error: reported.slice(0, 300) })
        : cause
          ? interpolate(RUN_TEXT.finishedWithCause, {
              subtype: result.subtype,
              cause: cause.slice(0, 300),
            })
          : interpolate(RUN_TEXT.finished, { subtype: result.subtype }),
    };
  }

  const detail = lastLine(exit.stderrTail);
  const exitDescription =
    exit.signal !== null
      ? interpolate(RUN_TEXT.signal, { signal: exit.signal })
      : interpolate(RUN_TEXT.exitCode, { code: exit.exitCode ?? "unknown" });
  return {
    runStatus: "FAILED",
    taskStatus: "FAILED",
    errorMessage: detail
      ? interpolate(RUN_TEXT.exitedWithDetail, { exit: exitDescription, detail })
      : interpolate(RUN_TEXT.exited, { exit: exitDescription }),
  };
}

export function lostSession(result: RunItemOf<"result"> | null): boolean {
  if (result === null || result.subtype !== "error_during_execution") return false;
  if ((result.numTurns ?? 0) > 0) return false;
  const errors = result.errors ?? [];
  return errors.length === 0 || errors.some((error) => /conversation|session/i.test(error));
}
