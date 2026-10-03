import {
  TaskKindSchema,
  type RoadmapEffort,
  type RoadmapLanguage,
  type RoadmapPriority,
  type TaskKind,
} from "@onyx/contracts";
import { z } from "zod";

export const ROADMAP_MARKER = "ONYX_ROADMAP_REQUEST";
export const MAX_ROADMAP_ITEMS = 15;

export interface RoadmapWorkspace {
  name: string;
  domain: string;
  pathGlobs: readonly string[];
}

export interface RoadmapKnowledge {
  projectName: string;
  language: RoadmapLanguage;
  focus: string | null;
  map: string | null;
  readme: string | null;
  manifests: ReadonlyArray<{ path: string; excerpt: string }>;
  todos: readonly string[];
  gitLog: readonly string[];
  workspaces: readonly RoadmapWorkspace[];
  existingTitles: readonly string[];
}

export interface RoadmapProposalItem {
  title: string;
  description: string;
  kind: TaskKind;
  priority: RoadmapPriority;
  effort: RoadmapEffort;
  workspace: string | null;
  targetPaths: string[];
  rationale: string | null;
}

export interface RoadmapProposal {
  summary: string | null;
  items: RoadmapProposalItem[];
}

const LANGUAGE_NAMES: Record<RoadmapLanguage, string> = { en: "English", it: "Italian" };

const KIND_ALIASES: Record<string, TaskKind> = {
  UI: "UI_STYLE",
  STYLE: "UI_STYLE",
  DESIGN: "UI_STYLE",
  BUG: "BUGFIX",
  FIX: "BUGFIX",
  TEST: "TEST_FIX",
  TESTS: "TEST_FIX",
  TESTING: "TEST_FIX",
  DOCUMENTATION: "DOCS",
  DOC: "DOCS",
  MAINTENANCE: "CHORE",
  SECURITY: "ARCHITECTURE",
  PERFORMANCE: "REFACTOR",
  INFRA: "CHORE",
};

export function normalizeKind(value: unknown): TaskKind {
  const raw = String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
  const direct = TaskKindSchema.safeParse(raw);
  if (direct.success) return direct.data;
  return KIND_ALIASES[raw] ?? "FEATURE";
}

function normalizePriority(value: unknown): RoadmapPriority {
  const raw = String(value ?? "")
    .trim()
    .toLowerCase();
  if (raw.startsWith("h") || raw === "p0" || raw === "p1" || raw === "alta") return "HIGH";
  if (raw.startsWith("l") || raw === "p3" || raw === "bassa") return "LOW";
  return "MEDIUM";
}

function normalizeEffort(value: unknown): RoadmapEffort {
  const raw = String(value ?? "")
    .trim()
    .toUpperCase();
  if (raw.startsWith("S") || raw === "XS") return "S";
  if (raw.startsWith("L") || raw === "XL") return "L";
  return "M";
}

const ProposalItemSchema = z.object({
  title: z.string().trim().min(3).max(160),
  description: z.string().trim().min(1).max(4_000),
  kind: z.unknown().optional().transform(normalizeKind),
  priority: z.unknown().optional().transform(normalizePriority),
  effort: z.unknown().optional().transform(normalizeEffort),
  workspace: z
    .string()
    .trim()
    .max(64)
    .nullish()
    .transform((value) => (value && value.length > 0 ? value : null)),
  targetPaths: z
    .array(z.string().trim().min(1).max(512))
    .nullish()
    .transform((paths) =>
      [...new Set((paths ?? []).map((path) => path.replace(/^\.\//, "")))].slice(0, 12),
    ),
  rationale: z
    .string()
    .trim()
    .max(2_000)
    .nullish()
    .transform((value) => (value && value.length > 0 ? value : null)),
});

const ProposalSchema = z.object({
  summary: z
    .string()
    .trim()
    .max(2_000)
    .nullish()
    .transform((value) => value ?? null),
  items: z.array(z.unknown()).min(1),
});

export function jsonCandidates(text: string): string[] {
  const candidates: string[] = [];
  for (const match of text.matchAll(/```(?:json)?\s*\n([\s\S]*?)```/g)) {
    if (match[1]) candidates.push(match[1]);
  }
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first !== -1 && last > first) candidates.push(text.slice(first, last + 1));
  return candidates;
}

export function parseRoadmap(text: string): RoadmapProposal {
  for (const candidate of jsonCandidates(text)) {
    let raw: unknown;
    try {
      raw = JSON.parse(candidate);
    } catch {
      continue;
    }
    const parsed = ProposalSchema.safeParse(raw);
    if (!parsed.success) continue;
    const seen = new Set<string>();
    const items: RoadmapProposalItem[] = [];
    for (const entry of parsed.data.items) {
      const item = ProposalItemSchema.safeParse(entry);
      if (!item.success) continue;
      const key = item.data.title.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      items.push(item.data);
      if (items.length >= MAX_ROADMAP_ITEMS) break;
    }
    if (items.length > 0) return { summary: parsed.data.summary, items };
  }
  throw new Error("Claude did not return a roadmap in the expected JSON format");
}

export function withoutDuplicates(
  items: readonly RoadmapProposalItem[],
  existingTitles: readonly string[],
): RoadmapProposalItem[] {
  const existing = new Set(existingTitles.map((title) => title.trim().toLowerCase()));
  return items.filter((item) => !existing.has(item.title.trim().toLowerCase()));
}

export function collectTodos(
  files: ReadonlyArray<{ relPath: string; content: string }>,
  limit = 40,
): string[] {
  const todos: string[] = [];
  for (const file of files) {
    const lines = file.content.split("\n");
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index] ?? "";
      const match = /\b(TODO|FIXME|HACK|XXX)\b[:\s-]*(.{0,160})/.exec(line);
      if (!match) continue;
      todos.push(`${file.relPath}:${index + 1} ${match[1]}: ${(match[2] ?? "").trim()}`);
      if (todos.length >= limit) return todos;
    }
  }
  return todos;
}

function section(title: string, body: string | null): string[] {
  return body && body.trim().length > 0 ? [`## ${title}`, body.trim(), ""] : [];
}

export function buildRoadmapPrompt(knowledge: RoadmapKnowledge): string {
  const language = LANGUAGE_NAMES[knowledge.language];
  const workspaces = knowledge.workspaces
    .map(
      (workspace) => `- ${workspace.name} (${workspace.domain}): ${workspace.pathGlobs.join(", ")}`,
    )
    .join("\n");
  return [
    ROADMAP_MARKER,
    `# Roadmap for ${knowledge.projectName}`,
    "",
    "You are the planner of Onyx, a control panel that delegates coding tasks to Claude Code agents.",
    "Study this repository and propose the most valuable next tasks: missing features, bugs and risks, tests, refactors, security, performance, developer experience and documentation.",
    "Use Read, Grep and Glob (and the onyx tools when available) to verify what you suggest. Do not modify anything.",
    "",
    ...section("Operator focus", knowledge.focus),
    ...section("Workspaces", workspaces),
    ...section("Project map", knowledge.map),
    ...section("README", knowledge.readme),
    ...section(
      "Manifests",
      knowledge.manifests
        .map((manifest) => `### ${manifest.path}\n${manifest.excerpt}`)
        .join("\n\n"),
    ),
    ...section("TODO and FIXME notes", knowledge.todos.join("\n")),
    ...section("Recent commits", knowledge.gitLog.join("\n")),
    ...section(
      "Already planned (do not repeat)",
      knowledge.existingTitles.map((title) => `- ${title}`).join("\n"),
    ),
    "## Output",
    `Write titles, descriptions and rationales in ${language}.`,
    `Propose between 6 and ${MAX_ROADMAP_ITEMS - 3} tasks, each small enough for one agent session, ordered by value.`,
    "Each description must say what to change and how to verify it. Use real paths from the repository.",
    "Reply with a single JSON object and nothing else, in this shape:",
    "```json",
    JSON.stringify(
      {
        summary: "Two sentences on the state of the project.",
        items: [
          {
            title: "Short imperative title",
            description: "What to do, where, and how to check it is done.",
            kind: "FEATURE | BUGFIX | REFACTOR | ARCHITECTURE | UI_STYLE | TEST_FIX | DOCS | CHORE",
            priority: "high | medium | low",
            effort: "S | M | L",
            workspace: "One of the workspace names, or null",
            targetPaths: ["path/to/file.ts"],
            rationale: "Why this matters now.",
          },
        ],
      },
      null,
      2,
    ),
    "```",
  ].join("\n");
}

export function taskPromptFor(item: {
  description: string;
  rationale: string | null;
  targetPaths: readonly string[];
}): string {
  return [
    item.description.trim(),
    ...(item.rationale ? ["", `Why: ${item.rationale.trim()}`] : []),
    ...(item.targetPaths.length > 0
      ? ["", `Files likely involved: ${item.targetPaths.join(", ")}`]
      : []),
  ].join("\n");
}

export const PRIORITY_WEIGHT: Record<RoadmapPriority, number> = { HIGH: 10, MEDIUM: 0, LOW: -10 };
