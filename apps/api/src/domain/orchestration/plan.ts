import { ModelTierSchema, type ModelTier, type TaskKind } from "@onyx/contracts";
import { z } from "zod";
import { jsonCandidates, normalizeKind } from "../roadmap";

export const PLAN_MARKER = "ONYX_PLAN_REQUEST";
export const MAX_PLAN_TASKS = 12;
const MAX_TARGETS = 16;
const MAX_ACCEPTANCE = 8;

export interface PlanWorkspace {
  name: string;
  domain: string;
  pathGlobs: readonly string[];
}

export interface PlanNode {
  key: string;
  title: string;
  description: string;
  workspace: string | null;
  kind: TaskKind;
  tier: ModelTier | null;
  dependsOn: string[];
  targetPaths: string[];
  acceptance: string[];
}

export interface ValidatedPlan {
  summary: string;
  nodes: PlanNode[];
  order: string[];
  levels: Record<string, number>;
  warnings: string[];
}

export class PlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlanError";
  }
}

export const PLAN_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "tasks"],
  properties: {
    summary: { type: "string", description: "Two or three sentences on the approach." },
    tasks: {
      type: "array",
      minItems: 1,
      maxItems: MAX_PLAN_TASKS,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["key", "title", "description", "workspace", "dependsOn", "acceptance"],
        properties: {
          key: { type: "string", description: "Short kebab-case id, unique in the plan." },
          title: { type: "string" },
          description: {
            type: "string",
            description: "Self-contained instructions for the agent that will do this task.",
          },
          workspace: { type: "string", description: "One of the workspace names given." },
          kind: {
            type: "string",
            enum: ["FEATURE", "REFACTOR", "BUGFIX", "UI_STYLE", "TEST_FIX", "DOCS", "CHORE"],
          },
          tier: { type: "string", enum: ["SCOUT", "BUILDER", "ARCHITECT"] },
          dependsOn: { type: "array", items: { type: "string" } },
          targetPaths: { type: "array", items: { type: "string" } },
          acceptance: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
} as const;

const RawTaskSchema = z.object({
  key: z.string().trim().max(80).optional(),
  title: z.string().trim().min(3).max(160),
  description: z.string().trim().min(1).max(6_000),
  workspace: z.string().trim().max(64).nullish(),
  kind: z.unknown().optional(),
  tier: z.unknown().optional(),
  dependsOn: z.array(z.string()).nullish(),
  targetPaths: z.array(z.string()).nullish(),
  acceptance: z.array(z.string()).nullish(),
});

const RawPlanSchema = z.object({
  summary: z.string().trim().max(3_000).nullish(),
  tasks: z.array(z.unknown()).min(1),
});

function slug(text: string): string {
  return (
    text
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "task"
  );
}

function normalizeTier(value: unknown): ModelTier | null {
  const raw = String(value ?? "")
    .trim()
    .toUpperCase();
  if (raw === "APEX") return "ARCHITECT";
  const parsed = ModelTierSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

function normalizePath(path: string): string {
  return path.trim().replace(/^\.\//, "").replace(/\/+$/, "");
}

export function extractPlan(structured: unknown, text: string | null): unknown {
  if (typeof structured === "object" && structured !== null) return structured;
  if (typeof structured === "string") {
    try {
      return JSON.parse(structured) as unknown;
    } catch {
      return null;
    }
  }
  for (const candidate of jsonCandidates(text ?? "")) {
    try {
      const parsed: unknown = JSON.parse(candidate);
      if (RawPlanSchema.safeParse(parsed).success) return parsed;
    } catch {
      continue;
    }
  }
  return null;
}

export function topologicalLevels(nodes: ReadonlyArray<Pick<PlanNode, "key" | "dependsOn">>): {
  order: string[];
  levels: Record<string, number>;
} {
  const levels: Record<string, number> = {};
  const remaining = new Map(nodes.map((node) => [node.key, new Set(node.dependsOn)]));
  const order: string[] = [];
  while (remaining.size > 0) {
    const ready = [...remaining.entries()]
      .filter(([, deps]) => [...deps].every((dep) => levels[dep] !== undefined))
      .map(([key]) => key);
    if (ready.length === 0) {
      throw new PlanError(
        `The plan has a dependency cycle between: ${[...remaining.keys()].join(", ")}`,
      );
    }
    for (const key of ready) {
      const deps = remaining.get(key) ?? new Set<string>();
      levels[key] = deps.size === 0 ? 0 : Math.max(...[...deps].map((dep) => levels[dep] ?? 0)) + 1;
      order.push(key);
      remaining.delete(key);
    }
  }
  return { order, levels };
}

export function validatePlan(raw: unknown, workspaces: readonly PlanWorkspace[]): ValidatedPlan {
  const parsed = RawPlanSchema.safeParse(raw);
  if (!parsed.success) throw new PlanError("Claude did not return a plan in the expected format");
  const warnings: string[] = [];
  const byName = new Map(workspaces.map((workspace) => [workspace.name.toLowerCase(), workspace]));
  const nodes: PlanNode[] = [];
  const aliases = new Map<string, string>();
  for (const [index, entry] of parsed.data.tasks.entries()) {
    const task = RawTaskSchema.safeParse(entry);
    if (!task.success) {
      warnings.push(`Task ${index + 1} was skipped: it has no usable title or description`);
      continue;
    }
    if (nodes.length >= MAX_PLAN_TASKS) {
      warnings.push(`Only the first ${MAX_PLAN_TASKS} tasks were kept`);
      break;
    }
    const base = slug(task.data.key && task.data.key.length > 0 ? task.data.key : task.data.title);
    let key = base;
    for (let suffix = 2; nodes.some((node) => node.key === key); suffix += 1)
      key = `${base}-${suffix}`;
    if (task.data.key) aliases.set(task.data.key.trim().toLowerCase(), key);
    aliases.set(task.data.title.toLowerCase(), key);
    aliases.set(key, key);
    const workspace = task.data.workspace
      ? byName.get(task.data.workspace.toLowerCase())
      : undefined;
    if (task.data.workspace && !workspace)
      warnings.push(
        `${key}: unknown workspace "${task.data.workspace}", Onyx picks one from the files`,
      );
    nodes.push({
      key,
      title: task.data.title,
      description: task.data.description,
      workspace: workspace?.name ?? null,
      kind: normalizeKind(task.data.kind ?? "FEATURE"),
      tier: normalizeTier(task.data.tier),
      dependsOn: (task.data.dependsOn ?? []).map((dep) => dep.trim().toLowerCase()),
      targetPaths: [...new Set((task.data.targetPaths ?? []).map(normalizePath))]
        .filter((path) => path.length > 0 && !path.startsWith("..") && !path.startsWith("/"))
        .slice(0, MAX_TARGETS),
      acceptance: (task.data.acceptance ?? [])
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .slice(0, MAX_ACCEPTANCE),
    });
  }
  if (nodes.length === 0) throw new PlanError("The plan has no usable tasks");
  for (const node of nodes) {
    const resolved: string[] = [];
    for (const dep of node.dependsOn) {
      const target = aliases.get(dep) ?? aliases.get(slug(dep));
      if (!target) {
        warnings.push(`${node.key}: dropped the unknown dependency "${dep}"`);
        continue;
      }
      if (target === node.key) {
        warnings.push(`${node.key}: dropped a dependency on itself`);
        continue;
      }
      if (!resolved.includes(target)) resolved.push(target);
    }
    node.dependsOn = resolved;
  }
  const { order, levels } = topologicalLevels(nodes);
  return {
    summary: parsed.data.summary?.trim() || `${nodes.length} tasks`,
    nodes,
    order,
    levels,
    warnings,
  };
}

export interface PlannerPromptInput {
  projectName: string;
  goal: string;
  map: string | null;
  readme: string | null;
  workspaces: readonly PlanWorkspace[];
  testRunner: string | null;
  gitLog: readonly string[];
}

export function buildPlannerPrompt(input: PlannerPromptInput): string {
  const sections = [
    PLAN_MARKER,
    `You are the planner of Onyx for the project "${input.projectName}". Split the feature below into tasks that separate coding agents will implement, each in its own git worktree, possibly in parallel.`,
    `## Feature\n\n${input.goal.trim()}`,
    "## Workspaces\n\n" +
      input.workspaces
        .map(
          (workspace) =>
            `- ${workspace.name} (${workspace.domain}): ${workspace.pathGlobs.join(", ") || "no paths"}`,
        )
        .join("\n"),
    `## Tests\n\n${input.testRunner ? `The project uses ${input.testRunner}. After the tasks are merged Onyx runs the whole suite and the type checker.` : "No test runner was detected."}`,
  ];
  if (input.map) sections.push(`## Project map\n\n${input.map}`);
  if (input.readme) sections.push(`## README excerpt\n\n${input.readme}`);
  if (input.gitLog.length > 0) sections.push(`## Recent commits\n\n${input.gitLog.join("\n")}`);
  sections.push(
    [
      "## How to plan",
      "",
      "- Explore the code with Read, Grep and Glob before deciding; do not edit anything.",
      `- Return between 1 and ${MAX_PLAN_TASKS} tasks. Prefer fewer, larger tasks that each leave the project working.`,
      "- Put each task in the workspace that owns its files. Tasks of different workspaces that do not depend on each other run in parallel.",
      "- Two tasks that change the same file must not run in parallel: make one depend on the other.",
      "- dependsOn lists the keys of tasks whose changes this task needs. Keep the graph acyclic.",
      "- description must be self-contained: the agent sees only its task, the feature and the plan summary.",
      "- acceptance lists observable checks, ideally tests that should pass.",
      "- tier: SCOUT for trivial edits, BUILDER for normal work, ARCHITECT for design-heavy or risky changes.",
      "",
      "Answer with the JSON object only.",
    ].join("\n"),
  );
  return sections.join("\n\n");
}

export interface NodePromptInput {
  goal: string;
  summary: string;
  node: PlanNode;
  dependencies: ReadonlyArray<{ title: string; summary: string | null }>;
  siblings: ReadonlyArray<{ title: string; workspace: string | null }>;
}

export function nodePrompt(input: NodePromptInput): string {
  const lines = [
    input.node.description.trim(),
    "",
    "## Context",
    "",
    `This task is part of a plan for: ${input.goal.trim()}`,
    `Plan: ${input.summary}`,
  ];
  if (input.dependencies.length > 0) {
    lines.push("", "Already merged into your branch:");
    for (const dependency of input.dependencies)
      lines.push(
        `- ${dependency.title}${dependency.summary ? `: ${dependency.summary.slice(0, 300)}` : ""}`,
      );
  }
  if (input.siblings.length > 0) {
    lines.push("", "Other tasks of the plan (do not do them here):");
    for (const sibling of input.siblings)
      lines.push(`- ${sibling.title}${sibling.workspace ? ` (${sibling.workspace})` : ""}`);
  }
  if (input.node.acceptance.length > 0) {
    lines.push("", "## Acceptance criteria", "");
    for (const check of input.node.acceptance) lines.push(`- ${check}`);
  }
  lines.push(
    "",
    "You work in an isolated git worktree. Leave the changes uncommitted: Onyx commits and merges them.",
  );
  if (input.node.targetPaths.length > 0)
    lines.push(`Files likely involved: ${input.node.targetPaths.join(", ")}`);
  return lines.join("\n");
}
