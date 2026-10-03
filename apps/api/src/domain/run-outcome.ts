import type { ProcessExit } from "@onyx/agent-runtime";
import type { RunItemOf, RunStatus, TaskStatus } from "@onyx/contracts";

export interface RunOutcome {
  runStatus: RunStatus;
  taskStatus: TaskStatus;
  errorMessage: string | null;
}

const TIMEOUT_MESSAGES = {
  wall_clock_timeout: "Run exceeded its wall-clock limit",
  idle_timeout: "Run produced no output within the idle limit",
  init_timeout: "Claude Code did not initialise in time",
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
      return { runStatus: "ABORTED", taskStatus: "CANCELLED", errorMessage: "Aborted by operator" };
    case "shutdown":
      return {
        runStatus: "INTERRUPTED",
        taskStatus: "INTERRUPTED",
        errorMessage: "Interrupted by Onyx shutdown",
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
        errorMessage: `Unable to start Claude Code: ${exit.error ?? "unknown error"}`,
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
        errorMessage: "Run aborted by Claude Code",
      };
    }
    return {
      runStatus: "FAILED",
      taskStatus: "FAILED",
      errorMessage: `Claude Code finished with ${result.subtype}`,
    };
  }

  const detail = lastLine(exit.stderrTail);
  const exitDescription =
    exit.signal !== null ? `signal ${exit.signal}` : `exit code ${exit.exitCode ?? "unknown"}`;
  return {
    runStatus: "FAILED",
    taskStatus: "FAILED",
    errorMessage: `Claude Code exited without a result (${exitDescription})${detail ? `: ${detail}` : ""}`,
  };
}
