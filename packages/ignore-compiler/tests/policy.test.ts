import { describe, expect, it } from "vitest";
import {
  AGGRESSIVE_PRESET,
  compilePolicy,
  ContextPolicy,
  parseIgnoreFile,
  permissionPaths,
  policyHash,
  presetRules,
  renderIgnoreFile,
  rule,
  SECURITY_RULES,
  suggestRules,
  type FileStat,
} from "../src";

describe("rules", () => {
  it("round-trips .claudesignore files", () => {
    const text = "# comment\nnode_modules/\n\n!dist/keep.js\n./docs/*.png\n../escape\n";
    const rules = parseIgnoreFile(text);
    expect(rules.map((entry) => [entry.action, entry.pattern])).toEqual([
      ["EXCLUDE", "node_modules/"],
      ["INCLUDE", "dist/keep.js"],
      ["EXCLUDE", "docs/*.png"],
    ]);
    expect(renderIgnoreFile(rules)).toBe("node_modules/\n!dist/keep.js\ndocs/*.png\n");
  });
});

describe("ContextPolicy", () => {
  const policy = new ContextPolicy([
    rule("dist/"),
    rule("*.log"),
    rule("keep.log", { action: "INCLUDE" }),
    rule("docs/**/*.png"),
    rule("docs/logo.png", { action: "INCLUDE" }),
    rule(".env.local", { action: "INCLUDE" }),
    ...SECURITY_RULES,
  ]);

  it("follows gitignore semantics, last match wins", () => {
    expect(policy.isExcluded("dist/app.js")).toBe(true);
    expect(policy.isExcluded("packages/a/dist/app.js")).toBe(true);
    expect(policy.isExcluded("dist", true)).toBe(true);
    expect(policy.isExcluded("logs/error.log")).toBe(true);
    expect(policy.isExcluded("keep.log")).toBe(false);
    expect(policy.isExcluded("docs/a/b.png")).toBe(true);
    expect(policy.isExcluded("docs/logo.png")).toBe(false);
    expect(policy.isExcluded("src/app.ts")).toBe(false);
  });

  it("keeps locked security rules above user negations", () => {
    expect(policy.isExcluded(".env.local")).toBe(true);
    expect(policy.explain(".env.local").rule?.source).toBe("SECURITY");
  });

  it("explains which rule excluded a path", () => {
    expect(policy.explain("api/server.log").rule?.pattern).toBe("*.log");
    expect(policy.explain("src/app.ts")).toEqual({ excluded: false, rule: null });
  });

  it("has a stable hash that changes with the rules", () => {
    const same = new ContextPolicy([...policy.rules]);
    expect(policyHash(same)).toBe(policyHash(policy));
    expect(policyHash(new ContextPolicy([rule("x/")]))).not.toBe(policyHash(policy));
  });
});

describe("presets", () => {
  it("excludes dependencies, build output, lockfiles and generated code", () => {
    const aggressive = new ContextPolicy(presetRules("aggressive"));
    for (const path of [
      "node_modules/react/index.js",
      "apps/web/.next/server/app.js",
      "packages/db/src/generated/prisma/client.ts",
      "pnpm-lock.yaml",
      "src/__snapshots__/a.snap",
      "public/app.min.js",
      "api/__pycache__/x.pyc",
    ]) {
      expect(aggressive.isExcluded(path), path).toBe(true);
    }
    expect(aggressive.isExcluded("src/build.ts")).toBe(false);
    expect(AGGRESSIVE_PRESET.every((entry) => !entry.locked)).toBe(true);
  });
});

describe("suggestRules", () => {
  const stats: FileStat[] = [
    { relPath: "src/app.ts", sizeBytes: 4_000, rawTokens: 1_200, binary: false, centrality: 0.4 },
    { relPath: "src/core.ts", sizeBytes: 2_000, rawTokens: 600, binary: false, centrality: 0.3 },
    { relPath: "public/img/a.png", sizeBytes: 90_000, rawTokens: 0, binary: true, centrality: 0 },
    { relPath: "public/img/b.png", sizeBytes: 80_000, rawTokens: 0, binary: true, centrality: 0 },
    {
      relPath: "data/big.json",
      sizeBytes: 600_000,
      rawTokens: 190_000,
      binary: false,
      centrality: 0,
    },
    { relPath: "data/small.json", sizeBytes: 900, rawTokens: 300, binary: false, centrality: 0 },
    {
      relPath: "src/generated/api.ts",
      sizeBytes: 30_000,
      rawTokens: 9_000,
      binary: false,
      centrality: 0.5,
    },
  ];

  it("proposes heuristic rules with their token impact and central-file warnings", () => {
    const suggestions = suggestRules(stats, [], []);
    const byPattern = Object.fromEntries(suggestions.map((entry) => [entry.rule.pattern, entry]));
    expect(byPattern["/data/big.json"]).toMatchObject({ files: 1, tokens: 190_000 });
    expect(byPattern["public/img/**/*.png"]).toMatchObject({ files: 2 });
    expect(byPattern["/src/generated/"]).toMatchObject({
      files: 1,
      centralFiles: ["src/generated/api.ts"],
    });
    expect(byPattern["/data/small.json"]).toBeUndefined();
    expect(suggestions[0]?.rule.pattern).toBe("/data/big.json");
  });

  it("skips rules already present or fully covered by the profile", () => {
    const suggestions = suggestRules(
      stats,
      [rule("data/"), rule("public/")],
      presetRules("aggressive"),
    );
    const patterns = suggestions.map((entry) => entry.rule.pattern);
    expect(patterns).not.toContain("/data/big.json");
    expect(patterns).not.toContain("public/img/**/*.png");
    expect(patterns).toContain("node_modules/");
  });
});

describe("compilePolicy", () => {
  const root = "/srv/onyx/projects/demo";

  it("translates gitignore anchors to absolute permission paths", () => {
    expect(permissionPaths("dist/", root)).toEqual(["//srv/onyx/projects/demo/**/dist/**"]);
    expect(permissionPaths("/build/", root)).toEqual(["//srv/onyx/projects/demo/build/**"]);
    expect(permissionPaths("*.log", root)).toEqual([
      "//srv/onyx/projects/demo/**/*.log",
      "//srv/onyx/projects/demo/**/*.log/**",
    ]);
    expect(permissionPaths("docs/**", root)).toEqual(["//srv/onyx/projects/demo/docs/**"]);
  });

  it("passes rules through when there are no negations", () => {
    const compiled = compilePolicy(new ContextPolicy([rule("dist/"), ...SECURITY_RULES]), {
      projectRoot: root,
    });
    expect(compiled.mode).toBe("pass-through");
    expect(compiled.readDeny).toContain("Read(//srv/onyx/projects/demo/**/dist/**)");
    expect(compiled.readDeny).toContain("Read(//srv/onyx/projects/demo/**/.env)");
    expect(compiled.editDeny).toContain("Edit(//srv/onyx/projects/demo/**/.env)");
    expect(compiled.editDeny.some((entry) => entry.includes("dist"))).toBe(false);
  });

  it("materialises the excluded files when the profile has negations", () => {
    const policy = new ContextPolicy([
      rule("docs/"),
      rule("assets/*.png"),
      rule("assets/logo.png", { action: "INCLUDE" }),
      rule("node_modules/"),
    ]);
    const files = [
      "src/a.ts",
      "docs/a.md",
      "docs/b/c.md",
      "assets/a.png",
      "assets/logo.png",
      "assets/b.png",
    ];
    const compiled = compilePolicy(policy, { projectRoot: root, files });
    expect(compiled.mode).toBe("materialized");
    expect(compiled.readDeny.sort()).toEqual(
      [
        "Read(//srv/onyx/projects/demo/**/node_modules/**)",
        "Read(//srv/onyx/projects/demo/docs/**)",
        "Read(//srv/onyx/projects/demo/assets/a.png)",
        "Read(//srv/onyx/projects/demo/assets/a.png/**)",
        "Read(//srv/onyx/projects/demo/assets/b.png)",
        "Read(//srv/onyx/projects/demo/assets/b.png/**)",
      ].sort(),
    );
    expect(compiled.readDeny.some((entry) => entry.includes("logo"))).toBe(false);
  });

  it("caps the number of rules and reports truncation", () => {
    const rules = Array.from({ length: 20 }, (_, index) => rule(`/dir${index}/`));
    const compiled = compilePolicy(new ContextPolicy(rules), { projectRoot: root, maxRules: 5 });
    expect(compiled.readDeny).toHaveLength(5);
    expect(compiled.truncated).toBe(true);
  });
});
