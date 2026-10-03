import type {
  Domain,
  RouterWeights,
  RuleMatcher,
  ScoreComponents,
  TaskKind,
} from "@onyx/contracts";
import { DOMAIN_LABELS } from "./domains";

export const KIND_LABELS: Record<TaskKind, string> = {
  ARCHITECTURE: "Architecture",
  FEATURE: "Feature",
  REFACTOR: "Refactor",
  BUGFIX: "Bug fix",
  UI_STYLE: "UI / styling",
  TEST_FIX: "Test fix",
  DOCS: "Docs",
  CHORE: "Chore",
};

export const WEIGHT_LABELS: Record<keyof RouterWeights, { label: string; hint: string }> = {
  blastRadius: { label: "Blast radius", hint: "Files that import the targets, capped at 25" },
  crossDomain: { label: "Cross-domain", hint: "Targets span more than one workspace" },
  filesTouched: { label: "Files touched", hint: "Target files, capped at 10" },
  archKeywords: { label: "Architecture keywords", hint: "Schema, migration, security… (2 max)" },
  contextTokens: { label: "Context size", hint: "Tokens of the targets, capped at 60k" },
  priorFailures: { label: "Prior failures", hint: "Failed runs of the same task, capped at 2" },
};

export const WEIGHT_KEYS = Object.keys(WEIGHT_LABELS) as Array<keyof RouterWeights>;

export function weightSum(weights: RouterWeights): number {
  return Math.round(WEIGHT_KEYS.reduce((sum, key) => sum + weights[key], 0) * 1_000) / 1_000;
}

export function topComponents(
  components: ScoreComponents,
  limit = 3,
): Array<{ key: keyof ScoreComponents; value: number }> {
  return WEIGHT_KEYS.map((key) => ({ key, value: components[key] }))
    .filter((entry) => entry.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);
}

function list(values: readonly string[] | undefined): string | null {
  return values && values.length > 0 ? values.join(", ") : null;
}

export function describeMatcher(matcher: RuleMatcher): string {
  const parts = [
    list(matcher.taskKinds?.map((kind) => KIND_LABELS[kind])),
    list(matcher.workspaceDomains?.map((domain: Domain) => DOMAIN_LABELS[domain])),
    matcher.pathGlobs && matcher.pathGlobs.length > 0
      ? `paths ${matcher.pathGlobs.join(", ")}`
      : null,
    matcher.keywordsAny && matcher.keywordsAny.length > 0
      ? `keywords ${matcher.keywordsAny.slice(0, 6).join(", ")}${matcher.keywordsAny.length > 6 ? "…" : ""}`
      : null,
    matcher.maxFilesTouched !== undefined ? `≤ ${matcher.maxFilesTouched} files` : null,
    matcher.maxBlastRadius !== undefined ? `blast ≤ ${matcher.maxBlastRadius}` : null,
    matcher.styleOnly ? "style files only" : null,
  ].filter((part): part is string => part !== null);
  return parts.length > 0 ? parts.join(" · ") : "Every task";
}

export function splitList(text: string): string[] {
  return [
    ...new Set(
      text
        .split(/[\n,]/)
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0),
    ),
  ];
}

export function scorePosition(value: number, max: number): number {
  if (max <= 0) return 0;
  return Math.max(0, Math.min(100, (value / max) * 100));
}
