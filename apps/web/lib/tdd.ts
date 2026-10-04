import type { TddIterationDto, TddLoopDto, TddPhase, TddScope, TddStatus } from "@onyx/contracts";
import type { BadgeProps } from "@/components/ui/badge";
import { english, msg, type Translate } from "@/lib/i18n/core";

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
  PENDING: msg("Starting"),
  RUNNING: msg("Running"),
  GREEN: msg("Green"),
  EXHAUSTED: msg("Out of attempts"),
  STALLED: msg("Stalled"),
  ABORTED: msg("Stopped"),
  FAILED: msg("Failed"),
};

export const TDD_PHASE_LABELS: Record<TddPhase, string> = {
  preparing: msg("Protecting the test files"),
  tests: msg("Running the tests"),
  gates: msg("Checking types and lint"),
  agent: msg("The agent is fixing the code"),
  guard: msg("Checking the test files"),
};

export const TDD_SCOPE_LABELS: Record<TddScope, string> = {
  related: msg("Related tests"),
  full: msg("Full suite"),
  typecheck: msg("Type check"),
  lint: msg("Lint"),
  run: msg("Runner error"),
  guard: msg("Tests restored"),
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

export function runnerLabel(runner: string | null, t: Translate = english): string {
  if (runner === "VITEST") return "Vitest";
  if (runner === "JEST") return "Jest";
  return t("none found");
}
