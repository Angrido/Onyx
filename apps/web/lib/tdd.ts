import type { TddIterationDto, TddLoopDto, TddPhase, TddScope, TddStatus } from "@onyx/contracts";
import type { BadgeProps } from "@/components/ui/badge";

type Tone = NonNullable<BadgeProps["tone"]>;

export const TDD_STATUS_TONES: Record<TddStatus, Tone> = {
  PENDING: "neutral",
  RUNNING: "primary",
  GREEN: "success",
  EXHAUSTED: "danger",
  STALLED: "warning",
  ABORTED: "neutral",
  FAILED: "danger",
};

export const TDD_STATUS_LABELS: Record<TddStatus, string> = {
  PENDING: "Starting",
  RUNNING: "Running",
  GREEN: "Green",
  EXHAUSTED: "Out of attempts",
  STALLED: "Stalled",
  ABORTED: "Stopped",
  FAILED: "Failed",
};

export const TDD_PHASE_LABELS: Record<TddPhase, string> = {
  preparing: "Protecting the test files",
  tests: "Running the tests",
  gates: "Checking types and lint",
  agent: "The agent is fixing the code",
  guard: "Checking the test files",
};

export const TDD_SCOPE_LABELS: Record<TddScope, string> = {
  related: "Related tests",
  full: "Full suite",
  typecheck: "Type check",
  lint: "Lint",
  run: "Runner error",
  guard: "Tests restored",
};

export type IterationOutcome = "green" | "red" | "reverted";

export function isLoopActive(loop: Pick<TddLoopDto, "status">): boolean {
  return loop.status === "RUNNING" || loop.status === "PENDING";
}

export function iterationOutcome(
  iteration: Pick<TddIterationDto, "scope" | "failed">,
): IterationOutcome {
  if (iteration.scope === "guard") return "reverted";
  return iteration.failed === 0 ? "green" : "red";
}

export function upsertLoop(loops: readonly TddLoopDto[], loop: TddLoopDto): TddLoopDto[] {
  const others = loops.filter((entry) => entry.id !== loop.id);
  return [loop, ...others].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function attemptsLabel(loop: Pick<TddLoopDto, "iterationCount" | "maxIterations">): string {
  return `${loop.iterationCount}/${loop.maxIterations}`;
}

export function runnerLabel(runner: string | null): string {
  if (runner === "VITEST") return "Vitest";
  if (runner === "JEST") return "Jest";
  return "none found";
}
