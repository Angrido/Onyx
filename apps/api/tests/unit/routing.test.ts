import type { RoutingFeatures } from "@onyx/contracts";
import { describe, expect, it } from "vitest";
import { modelForTier, planRouting, type RoutingContext } from "../../src/domain/routing/decide";
import { extractFeatures, findArchitectureKeywords } from "../../src/domain/routing/features";
import { firstMatchingRule, matchRule, type RuleView } from "../../src/domain/routing/rules";
import {
  DEFAULT_THRESHOLDS,
  DEFAULT_WEIGHTS,
  scoreFeatures,
  tierForScore,
} from "../../src/domain/routing/scoring";

const SEED_RULES: RuleView[] = [
  {
    id: "r1",
    name: "architecture-work",
    priority: 10,
    projectId: null,
    matcher: { taskKinds: ["ARCHITECTURE"] },
    targetTier: "ARCHITECT",
    modelId: null,
  },
  {
    id: "r2",
    name: "database-changes",
    priority: 20,
    projectId: null,
    matcher: { workspaceDomains: ["DATABASE"], pathGlobs: ["**/prisma/**", "**/migrations/**"] },
    targetTier: "ARCHITECT",
    modelId: null,
  },
  {
    id: "r3",
    name: "ui-styling",
    priority: 30,
    projectId: null,
    matcher: { taskKinds: ["UI_STYLE"] },
    targetTier: "BUILDER",
    modelId: null,
  },
  {
    id: "r4",
    name: "docs-and-chores",
    priority: 50,
    projectId: null,
    matcher: { taskKinds: ["DOCS", "CHORE"] },
    targetTier: "SCOUT",
    modelId: null,
  },
];

function features(overrides: Partial<RoutingFeatures> = {}): RoutingFeatures {
  return {
    kind: "FEATURE",
    workspaceDomain: "FRONTEND",
    domains: ["FRONTEND"],
    crossDomain: false,
    filesTouched: 1,
    targets: ["apps/web/components/button.tsx"],
    blastRadius: 2,
    archKeywords: [],
    styleOnly: false,
    contextTokens: 800,
    priorFailures: 0,
    ...overrides,
  };
}

function context(overrides: Partial<RoutingContext> = {}): RoutingContext {
  return {
    features: features(),
    text: "Add a button",
    override: null,
    rules: SEED_RULES,
    weights: DEFAULT_WEIGHTS,
    thresholds: DEFAULT_THRESHOLDS,
    classifierConfidence: 0.5,
    previous: null,
    lastRun: null,
    ...overrides,
  };
}

describe("feature extraction", () => {
  it("collects domains, blast radius, keywords and style-only targets", () => {
    const extracted = extractFeatures({
      kind: "REFACTOR",
      title: "Ristrutturare lo schema",
      prompt: "Refactor the auth flow and the database migration",
      workspaceDomain: "BACKEND",
      targets: [
        { path: "apps/api/src/auth.ts", domain: "BACKEND", blastRadius: 14, rawTokens: 3_000 },
        {
          path: "packages/db/prisma/schema.prisma",
          domain: "DATABASE",
          blastRadius: 40,
          rawTokens: 2_000,
        },
      ],
      priorFailures: 1,
    });
    expect(extracted).toMatchObject({
      domains: ["BACKEND", "DATABASE"],
      crossDomain: true,
      filesTouched: 2,
      blastRadius: 40,
      styleOnly: false,
      contextTokens: 5_000,
      priorFailures: 1,
    });
    expect(extracted.archKeywords).toEqual(["schema", "migration", "security", "refactor"]);
  });

  it("recognises Italian architecture vocabulary and style-only edits", () => {
    expect(findArchitectureKeywords("Rivedere l'architettura e la sicurezza")).toEqual([
      "architecture",
      "security",
    ]);
    expect(findArchitectureKeywords("Change the button colour")).toEqual([]);
    const style = extractFeatures({
      kind: "UI_STYLE",
      title: "",
      prompt: "padding",
      workspaceDomain: "FRONTEND",
      targets: [
        { path: "apps/web/app/globals.css", domain: "FRONTEND", blastRadius: 0, rawTokens: 400 },
      ],
      priorFailures: 0,
    });
    expect(style.styleOnly).toBe(true);
    expect(style.crossDomain).toBe(false);
  });
});

describe("rules", () => {
  it("requires every criterion of a matcher", () => {
    const rule = SEED_RULES[1] as RuleView;
    expect(
      matchRule(
        rule,
        features({ workspaceDomain: "DATABASE", targets: ["packages/db/prisma/schema.prisma"] }),
        "",
      ),
    ).toMatchObject({ reasons: ["workspace DATABASE", "path packages/db/prisma/schema.prisma"] });
    expect(
      matchRule(
        rule,
        features({ workspaceDomain: "DATABASE", targets: ["packages/db/src/index.ts"] }),
        "",
      ),
    ).toBeNull();
    expect(
      matchRule(
        rule,
        features({ workspaceDomain: "BACKEND", targets: ["apps/api/prisma/x.prisma"] }),
        "",
      ),
    ).toBeNull();
  });

  it("matches keywords as word prefixes and respects limits", () => {
    const rule: RuleView = {
      id: "k",
      name: "small-ui",
      priority: 5,
      projectId: null,
      matcher: { keywordsAny: ["colore", "padding"], maxFilesTouched: 2, styleOnly: false },
      targetTier: "BUILDER",
      modelId: null,
    };
    expect(matchRule(rule, features(), "Cambia i colori del bottone")).toBeNull();
    expect(matchRule(rule, features(), "Aumenta il padding")).not.toBeNull();
    expect(matchRule(rule, features({ filesTouched: 3 }), "padding")).toBeNull();
    expect(matchRule({ ...rule, matcher: {} }, features(), "padding")).toBeNull();
  });

  it("orders by priority and prefers project rules on ties", () => {
    const global: RuleView = { ...(SEED_RULES[2] as RuleView), id: "g", priority: 30 };
    const local: RuleView = {
      ...global,
      id: "l",
      projectId: "p1",
      targetTier: "SCOUT",
      name: "z-local",
    };
    const match = firstMatchingRule([global, local], features({ kind: "UI_STYLE" }), "");
    expect(match?.rule.id).toBe("l");
  });
});

describe("scoring", () => {
  it("weights normalised features and maps scores to tiers", () => {
    const big = scoreFeatures(
      features({
        blastRadius: 30,
        crossDomain: true,
        filesTouched: 12,
        archKeywords: ["schema", "migration"],
        contextTokens: 90_000,
      }),
      DEFAULT_WEIGHTS,
    );
    expect(big.value).toBe(0.9);
    expect(tierForScore(big.value, "FEATURE", DEFAULT_THRESHOLDS)).toBe("ARCHITECT");
    const small = scoreFeatures(features(), DEFAULT_WEIGHTS);
    expect(small.value).toBeLessThan(0.2);
    expect(tierForScore(small.value, "FEATURE", DEFAULT_THRESHOLDS)).toBe("BUILDER");
    expect(tierForScore(small.value, "DOCS", DEFAULT_THRESHOLDS)).toBe("SCOUT");
  });
});

describe("routing plan", () => {
  it("honours operator overrides first", () => {
    const plan = planRouting(
      context({
        features: features({ kind: "ARCHITECTURE" }),
        override: { modelId: "claude-haiku-4-5", tier: "SCOUT", source: "task-override" },
      }),
    );
    expect(plan).toMatchObject({
      strategy: "OVERRIDE",
      tier: "SCOUT",
      modelId: "claude-haiku-4-5",
    });
  });

  it("routes UI work to the builder tier and architecture to the architect tier", () => {
    const ui = planRouting(context({ features: features({ kind: "UI_STYLE" }) }));
    expect(ui).toMatchObject({ strategy: "RULE", tier: "BUILDER" });
    expect(ui.rationale).toBe("Rule ui-styling matched (kind UI_STYLE)");
    const architecture = planRouting(context({ features: features({ kind: "ARCHITECTURE" }) }));
    expect(architecture).toMatchObject({
      strategy: "RULE",
      tier: "ARCHITECT",
      rule: { name: "architecture-work" },
    });
  });

  it("falls back to the heuristic and asks the classifier near a boundary", () => {
    const confident = planRouting(context());
    expect(confident).toMatchObject({ strategy: "HEURISTIC", tier: "BUILDER", classify: false });
    expect(confident.rationale).toMatch(/^Score 0\.\d\d < 0\.55: /);
    const borderline = planRouting(
      context({
        features: features({
          blastRadius: 25,
          crossDomain: true,
          filesTouched: 3,
        }),
      }),
    );
    expect(borderline.score?.value).toBeCloseTo(0.546, 3);
    expect(borderline).toMatchObject({ strategy: "HEURISTIC", tier: "BUILDER", classify: true });
  });

  it("escalates one tier after a turn-limit failure and comes back after success", () => {
    const escalated = planRouting(
      context({
        previous: { tier: "BUILDER", strategy: "HEURISTIC" },
        lastRun: { status: "FAILED", resultSubtype: "error_max_turns" },
      }),
    );
    expect(escalated).toMatchObject({ strategy: "ESCALATION", tier: "ARCHITECT", modelId: null });
    const ceiling = planRouting(
      context({
        features: features({ kind: "ARCHITECTURE" }),
        previous: { tier: "ARCHITECT", strategy: "RULE" },
        lastRun: { status: "FAILED", resultSubtype: "error_max_turns" },
      }),
    );
    expect(ceiling).toMatchObject({ strategy: "RULE", tier: "ARCHITECT" });
    const kept = planRouting(
      context({
        previous: { tier: "ARCHITECT", strategy: "ESCALATION" },
        lastRun: { status: "FAILED", resultSubtype: "error_during_execution" },
      }),
    );
    expect(kept).toMatchObject({ strategy: "ESCALATION", tier: "ARCHITECT" });
    const back = planRouting(
      context({
        previous: { tier: "ARCHITECT", strategy: "ESCALATION" },
        lastRun: { status: "COMPLETED", resultSubtype: "success" },
      }),
    );
    expect(back).toMatchObject({ strategy: "DEESCALATION", tier: "BUILDER" });
  });
});

describe("tier models", () => {
  const models = [
    { id: "claude-opus-5-5", tier: "ARCHITECT" as const, enabled: true },
    { id: "claude-sonnet-5-5", tier: "BUILDER" as const, enabled: true },
    { id: "claude-haiku-4-5", tier: "SCOUT" as const, enabled: false },
    { id: "claude-fable-5-1", tier: "APEX" as const, enabled: false },
  ];

  it("picks the enabled model of the tier, or the nearest lower tier", () => {
    expect(modelForTier("ARCHITECT", models)).toEqual({
      modelId: "claude-opus-5-5",
      tier: "ARCHITECT",
      substituted: false,
    });
    expect(modelForTier("APEX", models)).toMatchObject({
      modelId: "claude-opus-5-5",
      substituted: true,
    });
    expect(modelForTier("SCOUT", models)).toMatchObject({
      modelId: "claude-sonnet-5-5",
      tier: "BUILDER",
    });
    expect(modelForTier("BUILDER", [])).toBeNull();
  });
});
