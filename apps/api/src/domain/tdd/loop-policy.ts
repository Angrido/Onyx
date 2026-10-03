export type TddStage = "run" | "related" | "full" | "typecheck" | "lint";

export const STAGE_RANK: Readonly<Record<TddStage, number>> = {
  run: 0,
  related: 1,
  full: 2,
  typecheck: 3,
  lint: 4,
};

export const DEFAULT_MAX_ITERATIONS = 6;
export const NO_PROGRESS_BEFORE_ESCALATION = 2;
export const SAME_SIGNATURE_BEFORE_STALL = 3;

export interface StageOutcome {
  stage: TddStage;
  failed: number;
  signature: string | null;
}

export interface LoopProgress {
  fixes: number;
  noProgressStreak: number;
  escalated: boolean;
  sameSignatureStreak: number;
  lastSignature: string | null;
  previous: StageOutcome | null;
}

export type LoopDecision =
  | { action: "fix"; escalate: boolean }
  | { action: "stop"; status: "EXHAUSTED" | "STALLED" | "ABORTED"; reason: string };

export function initialProgress(): LoopProgress {
  return {
    fixes: 0,
    noProgressStreak: 0,
    escalated: false,
    sameSignatureStreak: 0,
    lastSignature: null,
    previous: null,
  };
}

export function madeProgress(previous: StageOutcome | null, current: StageOutcome): boolean {
  if (previous === null) return true;
  const rankDelta = STAGE_RANK[current.stage] - STAGE_RANK[previous.stage];
  if (rankDelta !== 0) return rankDelta > 0;
  return current.failed < previous.failed;
}

export function observe(progress: LoopProgress, outcome: StageOutcome): LoopProgress {
  const comparable = progress.previous !== null && progress.fixes > 0;
  const progressed = comparable ? madeProgress(progress.previous, outcome) : true;
  const sameSignatureStreak = progress.escalated
    ? outcome.signature !== null && outcome.signature === progress.lastSignature
      ? progress.sameSignatureStreak + 1
      : 1
    : 0;
  return {
    ...progress,
    noProgressStreak: progressed ? 0 : progress.noProgressStreak + 1,
    sameSignatureStreak,
    lastSignature: outcome.signature,
    previous: outcome,
  };
}

export function decideNext(
  progress: LoopProgress,
  limits: { maxIterations: number; budgetUsd: number | null; spentUsd: number },
): LoopDecision {
  if (limits.budgetUsd !== null && limits.spentUsd >= limits.budgetUsd) {
    return {
      action: "stop",
      status: "ABORTED",
      reason: `The loop budget of $${limits.budgetUsd.toFixed(2)} is spent ($${limits.spentUsd.toFixed(4)})`,
    };
  }
  if (progress.fixes >= limits.maxIterations) {
    return {
      action: "stop",
      status: "EXHAUSTED",
      reason: `Still failing after ${progress.fixes} fix attempts (limit ${limits.maxIterations})`,
    };
  }
  if (progress.escalated && progress.sameSignatureStreak >= SAME_SIGNATURE_BEFORE_STALL) {
    return {
      action: "stop",
      status: "STALLED",
      reason: `The same failures came back ${progress.sameSignatureStreak} times in a row after the escalation`,
    };
  }
  return {
    action: "fix",
    escalate: !progress.escalated && progress.noProgressStreak >= NO_PROGRESS_BEFORE_ESCALATION,
  };
}

export function markEscalated(progress: LoopProgress): LoopProgress {
  return { ...progress, escalated: true, sameSignatureStreak: 0 };
}

export function recordFix(progress: LoopProgress): LoopProgress {
  return { ...progress, fixes: progress.fixes + 1 };
}

export function regressionsOf(
  previousPassed: ReadonlySet<string> | null,
  currentFailing: readonly string[],
): string[] {
  if (previousPassed === null) return [];
  return currentFailing.filter((id) => previousPassed.has(id));
}

export interface FixPromptInput {
  taskTitle: string;
  taskPrompt: string;
  iteration: number;
  maxIterations: number;
  stageLabel: string;
  digest: string;
  revertedFiles: readonly string[];
  escalated: boolean;
  includeTask: boolean;
}

export const TDD_PROMPT_MARKER = "Onyx TDD loop";

export function buildFixPrompt(input: FixPromptInput): string {
  const lines = [
    `${TDD_PROMPT_MARKER} · fix attempt ${input.iteration} of ${input.maxIterations} · ${input.stageLabel}`,
    "",
  ];
  if (input.revertedFiles.length > 0) {
    lines.push(
      `Your previous attempt changed protected test files (${input.revertedFiles.join(", ")}). Onyx restored them: the tests are the specification. Change the implementation instead.`,
      "",
    );
  }
  if (input.escalated) {
    lines.push(
      "The previous attempts did not reduce the failures. Step back, read the failing code paths carefully and look for the root cause before editing.",
      "",
    );
  }
  if (input.includeTask) {
    lines.push(`Task: ${input.taskTitle}`, "", input.taskPrompt.trim(), "");
  } else {
    lines.push(`Task: ${input.taskTitle}`, "");
  }
  lines.push(
    "Rules for this loop:",
    "- Fix the implementation so the failures below go away. Keep the change minimal.",
    "- Do not edit test files, snapshots, mocks or the test runner configuration: they are read-only and any change is reverted.",
    "- Do not run the tests or the type checker: Onyx runs them after your turn and sends you a new digest.",
    "",
    "Failures:",
    "",
    input.digest,
  );
  return lines.join("\n");
}
