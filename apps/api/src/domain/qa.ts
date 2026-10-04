import type { QaCriterion, QaIssue } from "@onyx/contracts";

export const QA_MARKER = "ONYX_QA_REQUEST";
export const RESOLUTION_MARKER = "ONYX_MERGE_RESOLUTION";
export const QA_DIFF_BUDGET_TOKENS = 12_000;
export const QA_MAX_REWORKS = 1;
export const QA_MAX_TURNS = 12;
export const RESOLUTION_MAX_TURNS = 30;
const MAX_TEXT = 600;

export const QA_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["verdict", "summary", "criteria", "issues"],
  properties: {
    verdict: { type: "string", enum: ["pass", "fail"] },
    summary: { type: "string", description: "Two or three sentences on the change." },
    criteria: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["index", "met", "evidence"],
        properties: {
          index: { type: "integer", description: "Number of the acceptance criterion." },
          met: { type: "boolean" },
          evidence: {
            type: "string",
            description: "Where the diff shows it, as path:line and a short quote.",
          },
        },
      },
    },
    issues: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["problem"],
        properties: {
          file: { type: "string" },
          problem: { type: "string" },
        },
      },
    },
  },
} as const;

export interface TruncatedDiff {
  text: string;
  tokens: number;
  truncated: boolean;
  files: string[];
}

function fileOf(chunk: string): string | null {
  const match = /^diff --git a\/(.+?) b\/(.+)$/m.exec(chunk);
  return match?.[2] ?? null;
}

export function truncateDiff(
  diff: string,
  budgetTokens: number,
  count: (text: string) => number,
): TruncatedDiff {
  const chunks = diff.split(/(?=^diff --git )/m).filter((chunk) => chunk.trim().length > 0);
  const files = chunks.map(fileOf).filter((file): file is string => file !== null);
  const kept: string[] = [];
  let tokens = 0;
  let truncated = false;
  for (const chunk of chunks) {
    const cost = count(chunk);
    if (tokens + cost <= budgetTokens) {
      kept.push(chunk);
      tokens += cost;
      continue;
    }
    truncated = true;
    const header = chunk.split("\n").slice(0, 4).join("\n");
    const note = `${header}\n[diff of ${fileOf(chunk) ?? "this file"} left out: too long, read the file instead]\n`;
    kept.push(note);
    tokens += count(note);
  }
  return { text: kept.join(""), tokens, truncated, files };
}

export function qaPrompt(input: {
  title: string;
  description: string;
  acceptance: readonly string[];
  diff: TruncatedDiff;
  attempt: number;
}): string {
  const criteria =
    input.acceptance.length > 0
      ? input.acceptance.map((line, index) => `${index + 1}. ${line}`).join("\n")
      : "(none: judge the change against the task description)";
  return [
    `${QA_MARKER}`,
    "You review a change made by another agent before Onyx merges it. You cannot edit files or run commands: read the diff, open files only when the diff is not enough, and answer with the JSON the schema asks for.",
    `# Task\n${input.title}\n\n${input.description}`,
    `# Acceptance criteria\n${criteria}`,
    [
      "# Rules",
      "- For every criterion, say whether the diff meets it. `met: true` needs evidence from the diff: the path, the line and a short quote. Without evidence the criterion is not met.",
      "- List as issues only real problems: wrong behaviour, missing cases, broken callers, tests that do not test the change. Not style.",
      "- `verdict` is `pass` only when every criterion is met and no issue would block a merge.",
      `- Review attempt: ${input.attempt}.`,
    ].join("\n"),
    `# Changed files\n${input.diff.files.map((file) => `- ${file}`).join("\n") || "(none)"}`,
    `# Diff${input.diff.truncated ? " (some files left out, read them if needed)" : ""}\n\`\`\`diff\n${input.diff.text}\n\`\`\``,
  ].join("\n\n");
}

export interface QaOutcome {
  verdict: "PASS" | "FAIL";
  summary: string;
  criteria: QaCriterion[];
  issues: QaIssue[];
}

function clip(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > MAX_TEXT ? `${flat.slice(0, MAX_TEXT - 1)}…` : flat;
}

function citesDiff(evidence: string, files: readonly string[]): boolean {
  return files.some((file) => {
    const name = file.split("/").pop() ?? file;
    return evidence.includes(file) || (name.length > 3 && evidence.includes(name));
  });
}

export function readQaOutput(
  raw: unknown,
  input: { acceptance: readonly string[]; files: readonly string[] },
): QaOutcome {
  if (typeof raw !== "object" || raw === null) throw new Error("The review returned no verdict");
  const record = raw as Record<string, unknown>;
  const said = record["verdict"];
  if (said !== "pass" && said !== "fail") throw new Error("The review returned no verdict");
  const given = new Map<number, { met: boolean; evidence: string }>();
  for (const entry of Array.isArray(record["criteria"]) ? record["criteria"] : []) {
    if (typeof entry !== "object" || entry === null) continue;
    const item = entry as Record<string, unknown>;
    if (typeof item["index"] !== "number") continue;
    given.set(item["index"], {
      met: item["met"] === true,
      evidence: typeof item["evidence"] === "string" ? clip(item["evidence"]) : "",
    });
  }
  const criteria = input.acceptance.map((text, position): QaCriterion => {
    const answer = given.get(position + 1);
    if (!answer) return { index: position + 1, text, met: false, evidence: "Not reviewed" };
    if (answer.met && !citesDiff(answer.evidence, input.files))
      return {
        index: position + 1,
        text,
        met: false,
        evidence: `No evidence from the diff${answer.evidence ? `: ${answer.evidence}` : ""}`,
      };
    return { index: position + 1, text, met: answer.met, evidence: answer.evidence };
  });
  const issues = (Array.isArray(record["issues"]) ? record["issues"] : []).flatMap(
    (entry): QaIssue[] => {
      if (typeof entry !== "object" || entry === null) return [];
      const item = entry as Record<string, unknown>;
      if (typeof item["problem"] !== "string" || item["problem"].trim().length === 0) return [];
      return [
        {
          file: typeof item["file"] === "string" && item["file"].length > 0 ? item["file"] : null,
          problem: clip(item["problem"]),
        },
      ];
    },
  );
  const verdict = said === "pass" && criteria.every((criterion) => criterion.met) ? "PASS" : "FAIL";
  return {
    verdict,
    summary: typeof record["summary"] === "string" ? clip(record["summary"]) : "",
    criteria,
    issues,
  };
}

export function qaFeedbackPrompt(outcome: {
  summary: string;
  criteria: readonly QaCriterion[];
  issues: readonly QaIssue[];
}): string {
  const unmet = outcome.criteria.filter((criterion) => !criterion.met);
  return [
    "A reviewer checked your change before the merge and found problems. Fix them in this worktree, keep what already works, and end with a short summary.",
    unmet.length > 0
      ? `Criteria not met:\n${unmet.map((criterion) => `- ${criterion.index}. ${criterion.text} (${criterion.evidence})`).join("\n")}`
      : null,
    outcome.issues.length > 0
      ? `Issues:\n${outcome.issues.map((issue) => `- ${issue.file ? `${issue.file}: ` : ""}${issue.problem}`).join("\n")}`
      : null,
    outcome.summary ? `Reviewer summary: ${outcome.summary}` : null,
  ]
    .filter((part): part is string => part !== null)
    .join("\n\n");
}

const CONFLICT_MARKER = /^(<{7}|={7}|>{7})(\s|$)/m;

export function hasConflictMarkers(text: string): boolean {
  return CONFLICT_MARKER.test(text);
}

export function resolutionPrompt(input: {
  title: string;
  description: string;
  branch: string;
  workBranch: string;
  files: readonly string[];
  merged: readonly string[];
}): string {
  return [
    RESOLUTION_MARKER,
    `Git stopped while merging ${input.branch} into ${input.workBranch}: some files have conflict markers. Resolve them so that both sides keep working.`,
    `# The task being merged\n${input.title}\n\n${input.description}`,
    input.merged.length > 0
      ? `# Already on ${input.workBranch}\n${input.merged.map((title) => `- ${title}`).join("\n")}`
      : null,
    `# Conflicted files\n${input.files.map((file) => `- ${file}`).join("\n")}`,
    [
      "# Rules",
      "- Edit only the conflicted files and remove every conflict marker (<<<<<<<, =======, >>>>>>>).",
      "- Keep the intent of both sides; when they cannot both stay, keep what the task being merged needs and say why.",
      "- Do not run commands and do not commit: Onyx runs the tests and asks the operator before applying.",
      "- End with two or three lines on how you resolved each file.",
    ].join("\n"),
  ]
    .filter((part): part is string => part !== null)
    .join("\n\n");
}
