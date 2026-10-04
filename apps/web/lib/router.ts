import type {
  Domain,
  RouterWeights,
  RuleMatcher,
  ScoreComponents,
  TaskKind,
  WorkspaceSource,
} from "@onyx/contracts";
import { DOMAIN_LABELS } from "./domains";
import { english, msg, type Translate } from "@/lib/i18n/core";

export const KIND_LABELS: Record<TaskKind, string> = {
  ARCHITECTURE: msg("Architecture"),
  FEATURE: msg("Feature"),
  REFACTOR: msg("Refactor"),
  BUGFIX: msg("Bug fix"),
  UI_STYLE: msg("UI / styling"),
  TEST_FIX: msg("Test fix"),
  DOCS: msg("Docs"),
  CHORE: msg("Chore"),
};

export const WORKSPACE_SOURCE_LABELS: Record<WorkspaceSource, string> = {
  chosen: msg("chosen by you"),
  targets: msg("owns the target files"),
  prompt: msg("from the prompt"),
  default: msg("default workspace"),
};

export function workspaceHint(
  name: string | null,
  source: WorkspaceSource | null | undefined,
  t: Translate = english,
): string {
  if (name === null) return t("no workspace");
  return source ? `${name} (${t(WORKSPACE_SOURCE_LABELS[source])})` : name;
}

export const WEIGHT_LABELS: Record<keyof RouterWeights, { label: string; hint: string }> = {
  blastRadius: {
    label: msg("Blast radius"),
    hint: msg("Files that import the targets, capped at 25"),
  },
  crossDomain: { label: msg("Cross-domain"), hint: msg("Targets span more than one workspace") },
  filesTouched: { label: msg("Files touched"), hint: msg("Target files, capped at 10") },
  archKeywords: {
    label: msg("Architecture keywords"),
    hint: msg("Schema, migration, security… (2 max)"),
  },
  contextTokens: { label: msg("Context size"), hint: msg("Tokens of the targets, capped at 60k") },
  priorFailures: {
    label: msg("Prior failures"),
    hint: msg("Failed runs of the same task, capped at 2"),
  },
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

export function describeMatcher(matcher: RuleMatcher, t: Translate = english): string {
  const keywords = matcher.keywordsAny ?? [];
  const parts = [
    list(matcher.taskKinds?.map((kind) => t(KIND_LABELS[kind]))),
    list(matcher.workspaceDomains?.map((domain: Domain) => t(DOMAIN_LABELS[domain]))),
    matcher.pathGlobs && matcher.pathGlobs.length > 0
      ? t("paths {paths}", { paths: matcher.pathGlobs.join(", ") })
      : null,
    keywords.length > 0
      ? t("keywords {keywords}", {
          keywords: `${keywords.slice(0, 6).join(", ")}${keywords.length > 6 ? "…" : ""}`,
        })
      : null,
    matcher.maxFilesTouched !== undefined
      ? t("≤ {count} files", { count: matcher.maxFilesTouched })
      : null,
    matcher.maxBlastRadius !== undefined
      ? t("blast ≤ {count}", { count: matcher.maxBlastRadius })
      : null,
    matcher.styleOnly ? t("style files only") : null,
  ].filter((part): part is string => part !== null);
  return parts.length > 0 ? parts.join(" · ") : t("Every task");
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
