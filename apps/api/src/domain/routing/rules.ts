import {
  RuleMatcherSchema,
  type ModelTier,
  type RoutingFeatures,
  type RuleMatcher,
} from "@onyx/contracts";
import picomatch from "picomatch";
import { interpolate } from "../../i18n";
import { RULE_REASON } from "./rationale";

export interface RuleView {
  id: string;
  name: string;
  priority: number;
  projectId: string | null;
  matcher: RuleMatcher;
  targetTier: ModelTier;
  modelId: string | null;
}

export interface RuleMatch {
  rule: RuleView;
  reasons: string[];
}

export function parseMatcher(value: unknown): RuleMatcher | null {
  const parsed = RuleMatcherSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function hasCriteria(matcher: RuleMatcher): boolean {
  return Object.values(matcher).some((value) =>
    Array.isArray(value) ? value.length > 0 : value !== undefined,
  );
}

function normalizedText(text: string): string {
  return ` ${text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ")} `;
}

export function matchRule(
  rule: RuleView,
  features: RoutingFeatures,
  text: string,
): RuleMatch | null {
  const matcher = rule.matcher;
  if (!hasCriteria(matcher)) return null;
  const reasons: string[] = [];

  if (matcher.taskKinds && matcher.taskKinds.length > 0) {
    if (!matcher.taskKinds.includes(features.kind)) return null;
    reasons.push(interpolate(RULE_REASON.kind, { kind: features.kind }));
  }
  if (matcher.workspaceDomains && matcher.workspaceDomains.length > 0) {
    const domain = features.workspaceDomain;
    if (domain === null || !matcher.workspaceDomains.includes(domain)) return null;
    reasons.push(interpolate(RULE_REASON.workspace, { workspace: domain }));
  }
  if (matcher.pathGlobs && matcher.pathGlobs.length > 0) {
    const isMatch = picomatch(matcher.pathGlobs, { dot: true });
    const hit = features.targets.find((path) => isMatch(path));
    if (hit === undefined) return null;
    reasons.push(interpolate(RULE_REASON.path, { path: hit }));
  }
  if (matcher.keywordsAny && matcher.keywordsAny.length > 0) {
    const haystack = normalizedText(text);
    const hit = matcher.keywordsAny.find((keyword) =>
      haystack.includes(normalizedText(keyword).trimEnd()),
    );
    if (hit === undefined) return null;
    reasons.push(interpolate(RULE_REASON.keyword, { keyword: hit }));
  }
  if (matcher.maxFilesTouched !== undefined) {
    if (features.filesTouched > matcher.maxFilesTouched) return null;
    reasons.push(
      interpolate(RULE_REASON.files, {
        count: features.filesTouched,
        max: matcher.maxFilesTouched,
      }),
    );
  }
  if (matcher.maxBlastRadius !== undefined) {
    if (features.blastRadius > matcher.maxBlastRadius) return null;
    reasons.push(
      interpolate(RULE_REASON.blastRadius, {
        count: features.blastRadius,
        max: matcher.maxBlastRadius,
      }),
    );
  }
  if (matcher.styleOnly !== undefined) {
    if (features.styleOnly !== matcher.styleOnly) return null;
    reasons.push(matcher.styleOnly ? RULE_REASON.styleOnly : RULE_REASON.notStyleOnly);
  }
  return { rule, reasons };
}

export function firstMatchingRule(
  rules: readonly RuleView[],
  features: RoutingFeatures,
  text: string,
): RuleMatch | null {
  const ordered = [...rules].sort(
    (a, b) =>
      a.priority - b.priority ||
      Number(b.projectId !== null) - Number(a.projectId !== null) ||
      a.name.localeCompare(b.name),
  );
  for (const rule of ordered) {
    const match = matchRule(rule, features, text);
    if (match) return match;
  }
  return null;
}
