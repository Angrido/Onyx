import type {
  ModelTier,
  RouterThresholds,
  RouterWeights,
  RoutingFeatures,
  RoutingStrategy,
  RunStatus,
} from "@onyx/contracts";
import { interpolate } from "../../i18n";
import { RATIONALE } from "./rationale";
import { firstMatchingRule, type RuleView } from "./rules";
import { confidenceOf, describeScore, scoreFeatures, tierForScore, type Score } from "./scoring";

export const TIER_ORDER: Readonly<Record<ModelTier, number>> = {
  SCOUT: 0,
  BUILDER: 1,
  ARCHITECT: 2,
  APEX: 3,
};

const TIERS_ASCENDING: readonly ModelTier[] = ["SCOUT", "BUILDER", "ARCHITECT", "APEX"];
const ESCALATION_CEILING: ModelTier = "ARCHITECT";
const ESCALATING_SUBTYPES = new Set(["error_max_turns"]);

export interface RoutingOverride {
  modelId: string;
  tier: ModelTier;
  source: "run-request" | "task-override";
}

export interface PreviousRouting {
  tier: ModelTier;
  strategy: RoutingStrategy;
}

export interface LastRunView {
  status: RunStatus;
  resultSubtype: string | null;
}

export interface RoutingEscalation {
  tier: ModelTier;
  reason: string;
}

export interface RoutingContext {
  features: RoutingFeatures;
  text: string;
  override: RoutingOverride | null;
  escalation?: RoutingEscalation | null;
  rules: readonly RuleView[];
  weights: RouterWeights;
  thresholds: RouterThresholds;
  classifierConfidence: number;
  previous: PreviousRouting | null;
  lastRun: LastRunView | null;
}

export interface RoutingPlan {
  strategy: RoutingStrategy;
  tier: ModelTier;
  modelId: string | null;
  rule: RuleView | null;
  score: Score | null;
  confidence: number | null;
  rationale: string;
  classify: boolean;
}

export interface ModelView {
  id: string;
  tier: ModelTier;
  enabled: boolean;
}

export interface TierModel {
  modelId: string;
  tier: ModelTier;
  substituted: boolean;
}

export function raiseTier(tier: ModelTier): ModelTier {
  const next = TIERS_ASCENDING[TIER_ORDER[tier] + 1] ?? tier;
  return TIER_ORDER[next] > TIER_ORDER[ESCALATION_CEILING] ? ESCALATION_CEILING : next;
}

export function shouldEscalate(lastRun: LastRunView | null): boolean {
  return (
    lastRun !== null &&
    lastRun.resultSubtype !== null &&
    ESCALATING_SUBTYPES.has(lastRun.resultSubtype)
  );
}

function basePlan(context: RoutingContext): RoutingPlan {
  const match = firstMatchingRule(context.rules, context.features, context.text);
  const score = scoreFeatures(context.features, context.weights);
  if (match) {
    return {
      strategy: "RULE",
      tier: match.rule.targetTier,
      modelId: match.rule.modelId,
      rule: match.rule,
      score,
      confidence: null,
      rationale: interpolate(RATIONALE.rule, {
        rule: match.rule.name,
        reasons: match.reasons.join(", "),
      }),
      classify: false,
    };
  }
  const tier = tierForScore(score.value, context.features.kind, context.thresholds);
  const confidence = confidenceOf(score.value, context.features.kind, context.thresholds);
  const band =
    tier === "ARCHITECT"
      ? `≥ ${context.thresholds.architect}`
      : tier === "SCOUT"
        ? interpolate(RATIONALE.lightBand, {
            threshold: context.thresholds.builder,
            kind: context.features.kind.toLowerCase(),
          })
        : `< ${context.thresholds.architect}`;
  return {
    strategy: "HEURISTIC",
    tier,
    modelId: null,
    rule: null,
    score,
    confidence,
    rationale: interpolate(RATIONALE.score, {
      score: score.value.toFixed(2),
      band,
      signals: describeScore(context.features),
    }),
    classify: confidence < context.classifierConfidence,
  };
}

export function planRouting(context: RoutingContext): RoutingPlan {
  if (context.override) {
    return {
      strategy: "OVERRIDE",
      tier: context.override.tier,
      modelId: context.override.modelId,
      rule: null,
      score: null,
      confidence: null,
      rationale:
        context.override.source === "run-request" ? RATIONALE.operatorRun : RATIONALE.pinned,
      classify: false,
    };
  }

  const base = basePlan(context);
  const { previous, lastRun, escalation } = context;
  if (escalation && TIER_ORDER[escalation.tier] > TIER_ORDER[base.tier]) {
    return {
      ...base,
      strategy: "ESCALATION",
      tier: escalation.tier,
      modelId: null,
      classify: false,
      rationale: interpolate(RATIONALE.escalated, {
        tier: escalation.tier,
        reason: escalation.reason,
        base: base.rationale,
      }),
    };
  }
  if (previous && shouldEscalate(lastRun)) {
    const escalated = raiseTier(previous.tier);
    if (TIER_ORDER[escalated] > TIER_ORDER[base.tier] && escalated !== previous.tier) {
      return {
        ...base,
        strategy: "ESCALATION",
        tier: escalated,
        modelId: null,
        classify: false,
        rationale: interpolate(RATIONALE.turnLimit, {
          previous: previous.tier,
          tier: escalated,
          base: base.rationale,
        }),
      };
    }
  }
  if (previous?.strategy === "ESCALATION" || previous?.strategy === "DEESCALATION") {
    if (
      previous.strategy === "ESCALATION" &&
      lastRun?.status === "COMPLETED" &&
      TIER_ORDER[base.tier] < TIER_ORDER[previous.tier]
    ) {
      return {
        ...base,
        strategy: "DEESCALATION",
        classify: false,
        rationale: interpolate(RATIONALE.back, {
          tier: base.tier,
          previous: previous.tier,
          base: base.rationale,
        }),
      };
    }
    if (
      previous.strategy === "ESCALATION" &&
      lastRun?.status !== "COMPLETED" &&
      TIER_ORDER[previous.tier] > TIER_ORDER[base.tier]
    ) {
      return {
        ...base,
        strategy: "ESCALATION",
        tier: previous.tier,
        modelId: null,
        classify: false,
        rationale: interpolate(RATIONALE.keeping, { tier: previous.tier, base: base.rationale }),
      };
    }
  }
  return base;
}

export function modelForTier(
  tier: ModelTier,
  models: readonly ModelView[],
  preferred: Partial<Record<ModelTier, string | null>> = {},
): TierModel | null {
  const enabled = models.filter((model) => model.enabled);
  const order = [
    tier,
    ...TIERS_ASCENDING.filter((candidate) => TIER_ORDER[candidate] < TIER_ORDER[tier]).reverse(),
    ...TIERS_ASCENDING.filter((candidate) => TIER_ORDER[candidate] > TIER_ORDER[tier]),
  ];
  for (const candidate of order) {
    const preferredId = preferred[candidate];
    const model =
      enabled.find((entry) => entry.id === preferredId && entry.tier === candidate) ??
      [...enabled]
        .filter((entry) => entry.tier === candidate)
        .sort((a, b) => a.id.localeCompare(b.id))[0];
    if (model) return { modelId: model.id, tier: candidate, substituted: candidate !== tier };
  }
  return null;
}
