import { describe, expect, it } from "vitest";
import {
  analyzerVersion,
  detectFileKind,
  detectLanguage,
  HANDLE_PATTERN,
  HeuristicTokenEstimator,
  LeanAnalyzer,
  renderMapLine,
  renderProjectMap,
  renderSymbolSource,
  symbolHandle,
} from "../src";

const analyzer = new LeanAnalyzer();

describe("languages", () => {
  it.each([
    ["src/a.ts", "typescript"],
    ["src/a.d.ts", "typescript"],
    ["src/a.mts", "typescript"],
    ["src/A.TSX", "tsx"],
    ["lib/a.cjs", "javascript"],
    ["lib/a.jsx", "javascript"],
    ["pkg/a.py", "python"],
    ["pkg/a.pyi", "python"],
  ])("%s → %s", (path, language) => {
    expect(detectLanguage(path)).toBe(language);
  });

  it("reports non-parseable kinds without a grammar", () => {
    expect(detectLanguage("README.md")).toBeNull();
    expect(detectFileKind("README.md")).toBe("markdown");
    expect(detectFileKind("deploy/Dockerfile")).toBe("dockerfile");
    expect(detectFileKind(".env")).toBeNull();
  });
});

describe("symbol handles", () => {
  it("are short, stable and path-qualified", () => {
    const handle = symbolHandle("src/a.ts", "Service.run");
    expect(handle).toMatch(HANDLE_PATTERN);
    expect(symbolHandle("src/a.ts", "Service.run")).toBe(handle);
    expect(symbolHandle("src/b.ts", "Service.run")).not.toBe(handle);
  });

  it("are spread enough to stay unique across a large project", () => {
    const handles = new Set<string>();
    for (let file = 0; file < 500; file += 1) {
      for (let symbol = 0; symbol < 40; symbol += 1) {
        handles.add(symbolHandle(`src/module-${file}.ts`, `symbol${symbol}`));
      }
    }
    expect(handles.size).toBe(20_000);
  });
});

describe("HeuristicTokenEstimator", () => {
  it("uses per-language ratios with a fallback", () => {
    const estimator = new HeuristicTokenEstimator({ python: 4 }, 2);
    expect(estimator.estimate("", "python")).toBe(0);
    expect(estimator.estimate("abcdefgh", "python")).toBe(2);
    expect(estimator.estimate("abcdefgh", "unknown")).toBe(4);
    expect(estimator.estimate("abcdefgh")).toBe(4);
  });
});

describe("LeanAnalyzer", () => {
  it("returns null for files without a grammar", () => {
    expect(analyzer.analyze("notes.md", "# title")).toBeNull();
  });

  it("handles empty files", () => {
    const analysis = analyzer.analyze("empty.ts", "");
    expect(analysis).toMatchObject({ symbols: [], imports: [], skeletonL1: "", rawTokens: 0 });
  });

  it("keeps the qualified name unique within a file", () => {
    const analysis = analyzer.analyze(
      "dup.py",
      "class A:\n    @property\n    def x(self): return 1\n    @x.setter\n    def x(self, v): pass\n",
    );
    expect(analysis?.symbols.map((symbol) => symbol.qualifiedName)).toEqual(["A", "A.x", "A.x~2"]);
  });

  it("points symbol ranges at the full declaration, docs and decorators included", () => {
    const source = [
      "import x from 'x';",
      "",
      "/** Adds. */",
      "@decorate()",
      "export class Calc {",
      "  add(a: number, b: number): number {",
      "    return a + b;",
      "  }",
      "}",
    ].join("\n");
    const analysis = analyzer.analyze("calc.ts", source);
    const calc = analysis?.symbols.find((symbol) => symbol.qualifiedName === "Calc");
    const add = analysis?.symbols.find((symbol) => symbol.qualifiedName === "Calc.add");
    expect(calc).toMatchObject({ startLine: 3, endLine: 9, exported: true });
    expect(add).toMatchObject({ startLine: 6, endLine: 8, kind: "method" });
    expect(source.slice(calc?.startOffset, calc?.endOffset)).toMatch(
      /^\/\*\* Adds\. \*\/[\s\S]*\}$/,
    );
    expect(renderSymbolSource(source, add?.startLine ?? 0, add?.endLine ?? 0).text).toBe(
      "6    add(a: number, b: number): number {\n7      return a + b;\n8    }",
    );
  });

  it("uses UTF-16 offsets that slice JavaScript strings correctly", () => {
    const source = "const emoji = '😀é';\nexport function after(): string {\n  return emoji;\n}\n";
    const analysis = analyzer.analyze("emoji.ts", source);
    const after = analysis?.symbols.find((symbol) => symbol.name === "after");
    expect(source.slice(after?.startOffset, after?.endOffset)).toMatch(/^export function after/);
  });

  it("parses large files quickly and shrinks them", () => {
    const body = Array.from(
      { length: 2_000 },
      (_, index) =>
        `export function handler${index}(input: number): number {\n  const doubled = input * 2;\n  return doubled + ${index};\n}\n`,
    ).join("\n");
    const started = performance.now();
    const analysis = analyzer.analyze("big.ts", body);
    const elapsed = performance.now() - started;
    expect(analysis?.symbols).toHaveLength(2_000);
    expect(analysis?.l1Tokens ?? Infinity).toBeLessThan((analysis?.rawTokens ?? 0) * 0.75);
    expect(elapsed).toBeLessThan(5_000);
  });

  it("records the analyzer version with grammar versions", () => {
    expect(analyzerVersion()).toMatch(
      /^lean-ctx\.\d+\+tree-sitter@[\d.]+\+typescript@[\d.]+\+javascript@[\d.]+\+python@[\d.]+$/,
    );
  });
});

describe("project map", () => {
  const estimator = new HeuristicTokenEstimator();
  const entries = [
    { relPath: "src/app.ts", tokens: 1_234, exports: ["buildApp", "AppOptions"], rank: 0.5 },
    { relPath: "src/config.ts", tokens: 300, exports: ["loadConfig"], rank: 0.3 },
    { relPath: "src/util/strings.ts", tokens: 90, exports: [], rank: 0.01 },
    { relPath: "README.md", tokens: 40, exports: [], rank: 0 },
  ];

  it("renders a single line per file", () => {
    expect(renderMapLine(entries[0] ?? entries[1]!)).toBe("src/app.ts ~1.2k: buildApp, AppOptions");
    expect(renderMapLine({ relPath: "a.ts", tokens: 5, exports: ["a", "b", "c"] }, 2)).toBe(
      "a.ts ~5: a, b, +1",
    );
  });

  it("groups by directory when everything fits", () => {
    const map = renderProjectMap(entries, { budgetTokens: 1_000, estimator });
    expect(map.text).toBe(
      [
        "./",
        "  README.md ~40",
        "src/",
        "  app.ts ~1.2k: buildApp, AppOptions",
        "  config.ts ~300: loadConfig",
        "src/util/",
        "  strings.ts ~90",
      ].join("\n"),
    );
    expect(map.omittedFiles).toBe(0);
  });

  it("drops the least central files first and counts them per directory", () => {
    const map = renderProjectMap(entries, { budgetTokens: 22, estimator });
    expect(map.text).toContain("app.ts");
    expect(map.text).toContain("src/util/ (+1 more)");
    expect(map.omittedFiles).toBeGreaterThan(0);
    expect(map.includedFiles + map.omittedFiles).toBe(entries.length);
  });
});

describe("excerpt", () => {
  const source = [
    'import { z } from "zod";',
    "export const ModeSchema = z.enum(['a', 'b']);",
    "export type Mode = z.infer<typeof ModeSchema>;",
    "export interface Options { mode: Mode; retries: number }",
    "function helper(): number { return 1; }",
    "export function run(options: Options): number {",
    "  return helper() + options.retries;",
    "}",
    "export const unrelated = 42;",
  ].join("\n");

  it("keeps the requested symbols and the same-file types they reference", () => {
    const excerpt = analyzer.excerpt("run.ts", source, 2, ["run"]);
    expect(excerpt?.names).toEqual(["run", "Options", "Mode", "ModeSchema"]);
    expect(excerpt?.text).toContain("export function run(options: Options): number {");
    expect(excerpt?.text).toContain("export interface Options");
    expect(excerpt?.text).not.toContain("helper");
    expect(excerpt?.text).not.toContain("unrelated");
    expect(excerpt?.text).not.toContain("import");
  });

  it("returns null when none of the names is declared in the file", () => {
    expect(analyzer.excerpt("run.ts", source, 1, ["missing"])).toBeNull();
  });
});

describe("AdjustableTokenEstimator", () => {
  it("applies calibrated ratios and a fallback", async () => {
    const { AdjustableTokenEstimator } = await import("../src");
    const estimator = new AdjustableTokenEstimator();
    expect(estimator.estimate("x".repeat(33), "typescript")).toBe(10);
    estimator.setRatios({ typescript: 4.1, "*": 2, broken: -1 });
    expect(estimator.estimate("x".repeat(41), "typescript")).toBe(10);
    expect(estimator.estimate("x".repeat(10), "unknown")).toBe(5);
    expect(estimator.estimate("x".repeat(10), "broken")).toBe(5);
  });
});
