import type { SurgeonFile } from "@onyx/contracts";
import { describe, expect, it } from "vitest";
import {
  buildTree,
  centralWarnings,
  composePolicy,
  diffEvaluations,
  directoryState,
  directoryStats,
  EMPTY_FILTER,
  evaluatePolicy,
  excludeTarget,
  filterFiles,
  flattenTree,
  includeTarget,
  manualRule,
  parseRuleInput,
  ruleLabel,
  type EditScope,
  type PolicyRule,
} from "@/lib/surgeon";

const SECURITY: PolicyRule[] = [
  { pattern: ".env", action: "EXCLUDE", source: "SECURITY", locked: true, reason: "Secrets" },
];

const PATHS = [
  ".env",
  "README.md",
  "dist/a.js",
  "dist/keep.js",
  "dist/sub/x.js",
  "dist/sub/keep.js",
  "logs/app.log",
  "packages/ui/dist/index.js",
  "src/app.ts",
  "src/core.ts",
  "src/util/strings.ts",
];

function file(path: string, rawTokens = 100, centrality = 0.01): SurgeonFile {
  return {
    path,
    kind: null,
    sizeBytes: rawTokens * 3,
    rawTokens,
    l1Tokens: null,
    binary: false,
    sensitive: false,
    domain: path.startsWith("src/") ? "BACKEND" : null,
    centrality,
  };
}

const FILES = PATHS.map((path) =>
  file(path, path === "src/core.ts" ? 500 : 100, path === "src/core.ts" ? 0.4 : 0.01),
);

function scope(inherited: PolicyRule[] = []): EditScope {
  return { inherited, security: SECURITY, paths: PATHS };
}

function excluded(editScope: EditScope, rules: readonly PolicyRule[]): string[] {
  const policy = composePolicy(editScope, rules);
  return PATHS.filter((path) => policy.isExcluded(path));
}

describe("rule input", () => {
  it("parses negations and rejects traversal", () => {
    expect(parseRuleInput("!dist/keep.js")).toMatchObject({
      pattern: "dist/keep.js",
      action: "INCLUDE",
    });
    expect(parseRuleInput("./logs/")).toMatchObject({ pattern: "logs/", action: "EXCLUDE" });
    expect(parseRuleInput("../secret")).toBeNull();
    expect(parseRuleInput("   ")).toBeNull();
    expect(ruleLabel(manualRule("dist/keep.js", "INCLUDE"))).toBe("!dist/keep.js");
  });
});

describe("including files", () => {
  it("rewrites a directory rule so a single file can come back", () => {
    const rules = [manualRule("dist/", "EXCLUDE")];
    const result = includeTarget(scope(), rules, "dist/keep.js", false);
    expect(result.exact).toBe(true);
    expect(result.rules.map(ruleLabel)).toEqual(["**/dist/**", "!/dist/keep.js"]);
    expect(excluded(scope(), result.rules)).toEqual([
      ".env",
      "dist/a.js",
      "dist/sub/x.js",
      "dist/sub/keep.js",
      "packages/ui/dist/index.js",
    ]);
  });

  it("re-includes the intermediate directories of a nested file", () => {
    const rules = [manualRule("dist/", "EXCLUDE")];
    const result = includeTarget(scope(), rules, "dist/sub/keep.js", false);
    expect(result.exact).toBe(true);
    expect(result.rules.map(ruleLabel)).toEqual([
      "**/dist/**",
      "!/dist/sub/",
      "!/dist/sub/keep.js",
    ]);
  });

  it("overrides an inherited directory rule from an overlay", () => {
    const inherited = [manualRule("dist/", "EXCLUDE")];
    const result = includeTarget(scope(inherited), [], "dist/sub/keep.js", false);
    expect(result.exact).toBe(true);
    expect(excluded(scope(inherited), result.rules)).toEqual([
      ".env",
      "dist/a.js",
      "dist/keep.js",
      "dist/sub/x.js",
      "packages/ui/dist/index.js",
    ]);
  });

  it("drops an exact exclusion instead of stacking a negation", () => {
    const rules = [manualRule("/src/core.ts", "EXCLUDE"), manualRule("*.log", "EXCLUDE")];
    expect(includeTarget(scope(), rules, "src/core.ts", false).rules.map(ruleLabel)).toEqual([
      "*.log",
    ]);
    expect(includeTarget(scope(), rules, "logs/app.log", false).rules.map(ruleLabel)).toEqual([
      "/src/core.ts",
      "*.log",
      "!/logs/app.log",
    ]);
  });

  it("never re-includes locked secrets", () => {
    const result = includeTarget(scope(), [], ".env", false);
    expect(result.rules).toEqual([]);
    expect(excluded(scope(), result.rules)).toEqual([".env"]);
  });

  it("includes a whole directory without touching its siblings", () => {
    const rules = [manualRule("dist/", "EXCLUDE")];
    const result = includeTarget(scope(), rules, "dist", true);
    expect(result.exact).toBe(true);
    expect(excluded(scope(), result.rules)).toEqual([".env", "packages/ui/dist/index.js"]);
  });
});

describe("excluding files", () => {
  it("anchors new exclusions to the selected path", () => {
    const result = excludeTarget(scope(), [], "src/util", true);
    expect(result.rules.map(ruleLabel)).toEqual(["/src/util/"]);
    expect(excludeTarget(scope(), [], "README.md", false).rules.map(ruleLabel)).toEqual([
      "/README.md",
    ]);
  });

  it("removes the negation that kept a file in context", () => {
    const rules = [manualRule("**/dist/**", "EXCLUDE"), manualRule("/dist/keep.js", "INCLUDE")];
    const result = excludeTarget(scope(), rules, "dist/keep.js", false);
    expect(result.rules.map(ruleLabel)).toEqual(["**/dist/**"]);
  });

  it("replaces nested rules when a directory is excluded", () => {
    const rules = [
      manualRule("**/dist/**", "EXCLUDE"),
      manualRule("/dist/sub/", "INCLUDE"),
      manualRule("/dist/sub/keep.js", "INCLUDE"),
      manualRule("/src/util/strings.ts", "EXCLUDE"),
    ];
    expect(excludeTarget(scope(), rules, "dist", true).rules.map(ruleLabel)).toEqual([
      "**/dist/**",
      "/src/util/strings.ts",
    ]);
    expect(excludeTarget(scope(), rules, "src", true).rules.map(ruleLabel)).toEqual([
      "**/dist/**",
      "!/dist/sub/",
      "!/dist/sub/keep.js",
      "/src/",
    ]);
  });
});

describe("evaluation", () => {
  const saved = [manualRule("dist/", "EXCLUDE")];
  const draft = [
    manualRule("**/dist/**", "EXCLUDE"),
    manualRule("/dist/keep.js", "INCLUDE"),
    manualRule("/src/core.ts", "EXCLUDE"),
  ];
  const savedEval = evaluatePolicy(composePolicy(scope(), saved), FILES, SECURITY);
  const draftEval = evaluatePolicy(composePolicy(scope(), draft), FILES, SECURITY);

  it("attributes excluded tokens to the deciding rule", () => {
    expect(savedEval.excludedTokens).toBe(600);
    expect(savedEval.locked).toEqual(new Set([".env"]));
    expect(savedEval.byRule.get(saved[0] as PolicyRule)).toEqual({ files: 5, tokens: 500 });
  });

  it("diffs a draft against the saved profile", () => {
    const diff = diffEvaluations(FILES, savedEval, draftEval);
    expect(diff.newlyExcluded.map((item) => item.path)).toEqual(["src/core.ts"]);
    expect(diff.newlyIncluded.map((item) => item.path)).toEqual(["dist/keep.js"]);
    expect(diff.tokenDelta).toBe(400);
  });

  it("warns when a central file leaves the context", () => {
    expect(centralWarnings(FILES, savedEval, draftEval)).toEqual([
      { file: FILES.find((item) => item.path === "src/core.ts"), isNew: true },
    ]);
  });

  it("aggregates directories into tri-state selections", () => {
    const stats = directoryStats(FILES, draftEval, savedEval);
    expect(directoryState(stats.get("dist"))).toBe("partial");
    expect(directoryState(stats.get("dist/sub"))).toBe("excluded");
    expect(directoryState(stats.get("src/util"))).toBe("included");
    expect(directoryState(stats.get(""))).toBe("partial");
    expect(stats.get("src")?.changed).toBe(1);
  });

  it("flattens the expanded tree with directories first", () => {
    const stats = directoryStats(FILES, draftEval, savedEval);
    const rows = flattenTree(buildTree(FILES), new Set(["src"]), "tokens", stats);
    expect(rows.map((row) => `${row.depth}:${row.node.name}`)).toEqual([
      "0:src",
      "1:util",
      "1:core.ts",
      "1:app.ts",
      "0:dist",
      "0:logs",
      "0:packages",
      "0:.env",
      "0:README.md",
    ]);
  });

  it("filters by state, domain and search", () => {
    const pick = (filter: Partial<typeof EMPTY_FILTER>) =>
      filterFiles(FILES, { ...EMPTY_FILTER, ...filter }, draftEval, savedEval).map(
        (item) => item.path,
      );
    expect(pick({ state: "changed" })).toEqual(["dist/keep.js", "src/core.ts"]);
    expect(pick({ domain: "BACKEND", state: "included" })).toEqual([
      "src/app.ts",
      "src/util/strings.ts",
    ]);
    expect(pick({ search: "KEEP", extension: "js" })).toEqual(["dist/keep.js", "dist/sub/keep.js"]);
    expect(pick({ domain: "SHARED", extension: "md" })).toEqual(["README.md"]);
  });
});
