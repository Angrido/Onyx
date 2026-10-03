import type { RunStatus, SessionEndReason } from "@onyx/contracts";

export interface RunDigest {
  workspaceName: string;
  taskTitle: string;
  status: RunStatus;
  endedAt: Date | null;
  changedFiles: readonly string[];
  summary: string | null;
}

export interface HandoffInput {
  workspaceName: string;
  reason: SessionEndReason | null;
  own: readonly RunDigest[];
  foreign: readonly RunDigest[];
  budgetTokens: number;
  estimate: (text: string) => number;
}

export interface Handoff {
  text: string;
  tokens: number;
  ownRuns: number;
  foreignRuns: number;
}

export const HANDOFF_BUDGET_TOKENS = 1_500;

const MAX_OPEN_ITEMS = 8;
const MAX_FILES_PER_RUN = 12;
const CHECKBOX_ITEM = /^\s*(?:[-*]\s*)?\[ \]\s*(.+)$/;
const MARKED_ITEM = /\b(?:TODO|FIXME)\b[:\s-]*(.+)$|\b(?:Next steps?|Follow[- ]ups?)\s*:\s*(.+)$/i;

const REASONS: Record<SessionEndReason, string> = {
  DOMAIN_SWITCH:
    "after a domain switch: work continued in other workspaces since the last session here",
  CONTEXT_PRESSURE: "because the previous session reached its context limit",
  MODEL_CHANGE: "because this task runs on a different model",
  MANUAL_RESET: "after a manual reset",
  COMPLETED: "after the previous session completed",
  ERROR: "because the previous session never started",
  BUDGET_EXCEEDED: "because the previous session exceeded its budget",
};

const STATUS_WORDS: Partial<Record<RunStatus, string>> = {
  COMPLETED: "completed",
  FAILED: "failed",
  ABORTED: "aborted",
  TIMEOUT: "timed out",
  INTERRUPTED: "interrupted",
};

function oneLine(text: string, limit: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= limit ? flat : `${flat.slice(0, limit - 1).trimEnd()}…`;
}

export function openItems(summaries: readonly (string | null)[]): string[] {
  const items: string[] = [];
  for (const summary of summaries) {
    for (const line of (summary ?? "").split("\n")) {
      const checkbox = CHECKBOX_ITEM.exec(line);
      const marked = checkbox ? null : MARKED_ITEM.exec(line);
      const item = (checkbox?.[1] ?? marked?.[1] ?? marked?.[2])?.trim();
      if (item && !items.includes(item)) items.push(item);
    }
  }
  return items.slice(-MAX_OPEN_ITEMS);
}

function describeRun(run: RunDigest, withWorkspace: boolean, summaryLimit: number): string {
  const status = STATUS_WORDS[run.status] ?? run.status.toLowerCase();
  const files =
    run.changedFiles.length === 0
      ? "no file edits recorded"
      : `changed ${run.changedFiles.slice(0, MAX_FILES_PER_RUN).join(", ")}${
          run.changedFiles.length > MAX_FILES_PER_RUN
            ? ` and ${run.changedFiles.length - MAX_FILES_PER_RUN} more`
            : ""
        }`;
  const prefix = withWorkspace ? `${run.workspaceName} · ` : "";
  const lines = [`- ${prefix}"${oneLine(run.taskTitle, 120)}" (${status}): ${files}`];
  if (run.summary && summaryLimit > 0)
    lines.push(`  Result: ${oneLine(run.summary, summaryLimit)}`);
  return lines.join("\n");
}

function render(
  input: HandoffInput,
  own: readonly RunDigest[],
  foreign: readonly RunDigest[],
  summaryLimit: number,
): string {
  const reason =
    input.reason === null ? "as the first session of this workspace" : REASONS[input.reason];
  const sections = [
    `# Handoff for the ${input.workspaceName} workspace`,
    `This session starts with a fresh context ${reason}. Use this note instead of the earlier conversation and re-read files before relying on what they used to contain.`,
  ];
  if (own.length > 0) {
    sections.push(
      [
        `## Earlier in ${input.workspaceName}`,
        ...own.map((run) => describeRun(run, false, summaryLimit)),
      ].join("\n"),
    );
  }
  if (foreign.length > 0) {
    sections.push(
      [
        "## Meanwhile in other workspaces",
        ...foreign.map((run) => describeRun(run, true, summaryLimit)),
      ].join("\n"),
    );
  }
  const items = openItems([...own, ...foreign].map((run) => run.summary));
  if (items.length > 0) {
    sections.push(["## Open items", ...items.map((item) => `- ${oneLine(item, 200)}`)].join("\n"));
  }
  return sections.join("\n\n");
}

export function composeHandoff(input: HandoffInput): Handoff | null {
  if (input.own.length === 0 && input.foreign.length === 0) return null;
  let own = [...input.own];
  let foreign = [...input.foreign];
  for (const summaryLimit of [400, 160, 0]) {
    let text = render(input, own, foreign, summaryLimit);
    while (input.estimate(text) > input.budgetTokens && own.length + foreign.length > 1) {
      const ownOldest = own[0]?.endedAt?.getTime() ?? Number.POSITIVE_INFINITY;
      const foreignOldest = foreign[0]?.endedAt?.getTime() ?? Number.POSITIVE_INFINITY;
      if (own.length > 0 && (foreign.length === 0 || ownOldest <= foreignOldest))
        own = own.slice(1);
      else foreign = foreign.slice(1);
      text = render(input, own, foreign, summaryLimit);
    }
    if (input.estimate(text) <= input.budgetTokens || summaryLimit === 0) {
      return {
        text,
        tokens: input.estimate(text),
        ownRuns: own.length,
        foreignRuns: foreign.length,
      };
    }
    own = [...input.own];
    foreign = [...input.foreign];
  }
  return null;
}
