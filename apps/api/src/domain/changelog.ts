import type { ChangelogEntryDto, ChangelogSection, TaskKind } from "@onyx/contracts";

export interface ChangelogCommit {
  sha: string;
  subject: string;
  body: string;
}

export interface ChangelogTask {
  id: string;
  title: string;
  kind: TaskKind;
}

export interface ParsedCommit {
  type: string;
  scope: string | null;
  breaking: boolean;
  description: string;
}

const CONVENTIONAL = /^(\w+)(?:\(([^)]+)\))?(!)?:\s+(.+)$/;
const SKIPPED_TYPES = new Set(["chore", "ci", "build", "test", "tests", "style", "release"]);
const TYPE_SECTIONS: Record<string, ChangelogSection> = {
  feat: "FEATURES",
  feature: "FEATURES",
  fix: "FIXES",
  bugfix: "FIXES",
  perf: "PERFORMANCE",
  refactor: "REFACTORING",
  docs: "DOCS",
  doc: "DOCS",
  revert: "OTHER",
};
const KIND_SECTIONS: Record<TaskKind, ChangelogSection | null> = {
  FEATURE: "FEATURES",
  UI_STYLE: "FEATURES",
  BUGFIX: "FIXES",
  TEST_FIX: "FIXES",
  REFACTOR: "REFACTORING",
  ARCHITECTURE: "FEATURES",
  DOCS: "DOCS",
  CHORE: null,
};

export const SECTION_TITLES: Record<ChangelogSection, string> = {
  BREAKING: "Breaking changes",
  FEATURES: "Features",
  FIXES: "Fixes",
  PERFORMANCE: "Performance",
  REFACTORING: "Refactoring",
  DOCS: "Documentation",
  OTHER: "Other changes",
};
const SECTION_ORDER: ChangelogSection[] = [
  "BREAKING",
  "FEATURES",
  "FIXES",
  "PERFORMANCE",
  "REFACTORING",
  "DOCS",
  "OTHER",
];

export function parseConventional(subject: string, body = ""): ParsedCommit | null {
  const match = CONVENTIONAL.exec(subject.trim());
  if (!match) return null;
  return {
    type: (match[1] ?? "").toLowerCase(),
    scope: match[2]?.trim() ?? null,
    breaking: match[3] === "!" || /^BREAKING[ -]CHANGE:/m.test(body),
    description: (match[4] ?? "").trim(),
  };
}

function sentence(text: string): string {
  const trimmed = text.trim().replace(/\.$/, "");
  return trimmed.length > 0 ? `${trimmed[0]?.toUpperCase() ?? ""}${trimmed.slice(1)}` : trimmed;
}

function normalized(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function commitEntry(commit: ChangelogCommit): ChangelogEntryDto | null {
  const subject = commit.subject.trim();
  if (subject.length === 0 || /^Merge (branch|pull request|remote-tracking)/.test(subject))
    return null;
  const parsed = parseConventional(subject, commit.body);
  const ref = commit.sha.slice(0, 7);
  if (!parsed)
    return { section: "OTHER", scope: null, text: sentence(subject), source: "COMMIT", ref };
  if (parsed.breaking)
    return {
      section: "BREAKING",
      scope: parsed.scope,
      text: sentence(parsed.description),
      source: "COMMIT",
      ref,
    };
  if (SKIPPED_TYPES.has(parsed.type)) return null;
  return {
    section: TYPE_SECTIONS[parsed.type] ?? "OTHER",
    scope: parsed.scope,
    text: sentence(parsed.description),
    source: "COMMIT",
    ref,
  };
}

export function buildChangelogEntries(
  commits: readonly ChangelogCommit[],
  tasks: readonly ChangelogTask[],
): ChangelogEntryDto[] {
  const entries: ChangelogEntryDto[] = [];
  const seen = new Set<string>();
  const subjects = commits.map((commit) => normalized(commit.subject));
  for (const task of tasks) {
    const section = KIND_SECTIONS[task.kind];
    const title = task.title.replace(/^Plan:\s*/i, "");
    const key = normalized(title);
    if (!section || key.length === 0 || seen.has(key)) continue;
    seen.add(key);
    entries.push({
      section,
      scope: null,
      text: sentence(title),
      source: "TASK",
      ref: task.id,
    });
  }
  for (const [index, commit] of commits.entries()) {
    const entry = commitEntry(commit);
    if (!entry) continue;
    const key = normalized(entry.text);
    const subject = subjects[index] ?? "";
    const covered = [...seen].some(
      (title) => title === key || (title.length >= 12 && subject.includes(title)),
    );
    if (covered || seen.has(key)) continue;
    seen.add(key);
    entries.push(entry);
  }
  return SECTION_ORDER.flatMap((section) => entries.filter((entry) => entry.section === section));
}

export function renderChangelog(
  version: string,
  date: string,
  entries: readonly ChangelogEntryDto[],
): string {
  const lines = [`## ${version} — ${date}`];
  if (entries.length === 0) lines.push("", "No notable changes.");
  for (const section of SECTION_ORDER) {
    const items = entries.filter((entry) => entry.section === section);
    if (items.length === 0) continue;
    lines.push("", `### ${SECTION_TITLES[section]}`, "");
    for (const item of items)
      lines.push(`- ${item.scope ? `**${item.scope}:** ` : ""}${item.text}`);
  }
  return lines.join("\n");
}

export function suggestVersion(
  previous: string | null,
  entries: readonly ChangelogEntryDto[],
  today: string,
): string {
  const match = previous ? /^(v?)(\d+)\.(\d+)\.(\d+)$/.exec(previous) : null;
  if (!match) return today;
  const prefix = match[1] ?? "";
  const major = Number(match[2]);
  const minor = Number(match[3]);
  const patch = Number(match[4]);
  if (entries.some((entry) => entry.section === "BREAKING"))
    return major === 0 ? `${prefix}0.${minor + 1}.0` : `${prefix}${major + 1}.0.0`;
  if (entries.some((entry) => entry.section === "FEATURES"))
    return `${prefix}${major}.${minor + 1}.0`;
  return `${prefix}${major}.${minor}.${patch + 1}`;
}

export const CHANGELOG_HEADER = "# Changelog";

export function prependChangelog(existing: string | null, section: string): string {
  const block = section.trim();
  if (!existing || existing.trim().length === 0) return `${CHANGELOG_HEADER}\n\n${block}\n`;
  const text = existing.replace(/\r\n?/g, "\n");
  const lines = text.split("\n");
  if (lines[0]?.startsWith("# ")) {
    let index = 1;
    while (index < lines.length && !lines[index]?.startsWith("## ")) index += 1;
    const head = lines.slice(0, index).join("\n").replace(/\n+$/, "");
    const rest = lines.slice(index).join("\n").replace(/^\n+/, "");
    return `${head}\n\n${block}\n${rest.length > 0 ? `\n${rest}` : ""}`.replace(/\n*$/, "\n");
  }
  return `${CHANGELOG_HEADER}\n\n${block}\n\n${text.replace(/^\n+/, "")}`.replace(/\n*$/, "\n");
}
