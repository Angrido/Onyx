export const MAX_BATCH = 4;
const SMALL_PROMPT_CHARS = 600;
const SMALL_TARGETS = 2;
const LARGE_KINDS = new Set(["ARCHITECTURE", "REFACTOR"]);

export interface BatchCandidate {
  kind: string;
  prompt: string;
  targetPaths: readonly string[];
  worktreePath: string | null;
  parentTaskId: string | null;
}

export function isSmallTask(task: BatchCandidate): boolean {
  return (
    !LARGE_KINDS.has(task.kind) &&
    task.prompt.length <= SMALL_PROMPT_CHARS &&
    task.targetPaths.length <= SMALL_TARGETS &&
    task.worktreePath === null &&
    task.parentTaskId === null
  );
}

export interface BatchTask {
  title: string;
  prompt: string;
  acceptance: readonly string[];
  targetPaths: readonly string[];
}

export function batchPrompt(tasks: readonly BatchTask[]): string {
  const sections = tasks.map((task, index) => {
    const lines = [`## Task ${index + 1}: ${task.title.trim()}`, task.prompt.trim()];
    if (task.acceptance.length > 0)
      lines.push(
        ["Acceptance criteria:", ...task.acceptance.map((line) => `- ${line}`)].join("\n"),
      );
    if (task.targetPaths.length > 0) lines.push(`Files: ${task.targetPaths.join(", ")}`);
    return lines.join("\n\n");
  });
  return [
    `# ${tasks.length} small tasks`,
    `Onyx grouped ${tasks.length} small tasks of this workspace into one run. Do them in order and keep each change separate. After finishing each task, write one line on its own: \`TASK <number>: DONE\` or \`TASK <number>: FAILED <short reason>\`.`,
    ...sections,
  ].join("\n\n");
}

export type BatchOutcome =
  { status: "DONE" } | { status: "FAILED"; reason: string } | { status: "MISSING" };

export function parseBatchOutcome(text: string | null, count: number): BatchOutcome[] {
  const outcomes: BatchOutcome[] = Array.from({ length: count }, () => ({ status: "MISSING" }));
  for (const line of (text ?? "").split("\n")) {
    const match = /^\W*TASK\s+(\d+)\s*:\s*(DONE|FAILED)\b[\s*_:—-]*(.*)$/i.exec(line.trim());
    if (!match) continue;
    const index = Number(match[1]) - 1;
    if (index < 0 || index >= count) continue;
    outcomes[index] =
      match[2]?.toUpperCase() === "DONE"
        ? { status: "DONE" }
        : {
            status: "FAILED",
            reason: (match[3] ?? "").trim().slice(0, 300) || "Reported as failed",
          };
  }
  return outcomes;
}
