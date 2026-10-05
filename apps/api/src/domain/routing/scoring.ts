import type {
  ModelTier,
  RouterThresholds,
  RouterWeights,
  RoutingFeatures,
  ScoreComponents,
} from "@onyx/contracts";
import { interpolate } from "../../i18n";
import { SIGNAL } from "./rationale";

export const DEFAULT_WEIGHTS: RouterWeights = {
  blastRadius: 0.3,
  crossDomain: 0.2,
  filesTouched: 0.15,
  archKeywords: 0.15,
  contextTokens: 0.1,
  priorFailures: 0.1,
};

export const DEFAULT_THRESHOLDS: RouterThresholds = { architect: 0.55, builder: 0.2 };

export const NORMALIZERS = {
  blastRadius: 25,
  filesTouched: 10,
  archKeywords: 2,
  contextTokens: 60_000,
  priorFailures: 2,
} as const;

const CONFIDENCE_MARGIN = 0.1;
const LIGHT_KINDS = new Set(["DOCS", "CHORE"]);

export interface Score {
  value: number;
  components: ScoreComponents;
}

function ratio(value: number, cap: number): number {
  return Math.max(0, Math.min(1, value / cap));
}

function round(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}

export function scoreFeatures(features: RoutingFeatures, weights: RouterWeights): Score {
  const components: ScoreComponents = {
    blastRadius: round(weights.blastRadius * ratio(features.blastRadius, NORMALIZERS.blastRadius)),
    crossDomain: round(weights.crossDomain * (features.crossDomain ? 1 : 0)),
    filesTouched: round(
      weights.filesTouched * ratio(features.filesTouched, NORMALIZERS.filesTouched),
    ),
    archKeywords: round(
      weights.archKeywords * ratio(features.archKeywords.length, NORMALIZERS.archKeywords),
    ),
    contextTokens: round(
      weights.contextTokens * ratio(features.contextTokens, NORMALIZERS.contextTokens),
    ),
    priorFailures: round(
      weights.priorFailures * ratio(features.priorFailures, NORMALIZERS.priorFailures),
    ),
  };
  const value = round(Object.values(components).reduce((sum, part) => sum + part, 0));
  return { value, components };
}

export function tierForScore(
  score: number,
  kind: RoutingFeatures["kind"],
  thresholds: RouterThresholds,
): ModelTier {
  if (score >= thresholds.architect) return "ARCHITECT";
  if (score >= thresholds.builder) return "BUILDER";
  return LIGHT_KINDS.has(kind) ? "SCOUT" : "BUILDER";
}

export function confidenceOf(
  score: number,
  kind: RoutingFeatures["kind"],
  thresholds: RouterThresholds,
): number {
  const boundaries = LIGHT_KINDS.has(kind)
    ? [thresholds.builder, thresholds.architect]
    : [thresholds.architect];
  const distance = Math.min(...boundaries.map((boundary) => Math.abs(score - boundary)));
  return round(Math.min(1, distance / CONFIDENCE_MARGIN));
}

export function describeScore(features: RoutingFeatures): string {
  const parts: string[] = [];
  if (features.blastRadius > 0)
    parts.push(interpolate(SIGNAL.blastRadius, { count: features.blastRadius }));
  if (features.crossDomain)
    parts.push(interpolate(SIGNAL.crossDomain, { domains: features.domains.join(", ") }));
  if (features.filesTouched > 0)
    parts.push(
      interpolate(features.filesTouched === 1 ? SIGNAL.file : SIGNAL.files, {
        count: features.filesTouched,
      }),
    );
  if (features.archKeywords.length > 0)
    parts.push(interpolate(SIGNAL.keywords, { keywords: features.archKeywords.join(", ") }));
  if (features.contextTokens > 0)
    parts.push(
      features.contextTokens >= 1_000
        ? interpolate(SIGNAL.kiloTokens, { count: Math.round(features.contextTokens / 1_000) })
        : interpolate(SIGNAL.tokens, { count: features.contextTokens }),
    );
  if (features.priorFailures > 0)
    parts.push(
      interpolate(features.priorFailures === 1 ? SIGNAL.failedRun : SIGNAL.failedRuns, {
        count: features.priorFailures,
      }),
    );
  return parts.length > 0 ? parts.join(", ") : SIGNAL.none;
}
