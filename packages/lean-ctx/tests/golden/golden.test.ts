import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LeanAnalyzer, type FileAnalysis } from "../../src";

const analyzer = new LeanAnalyzer();
const FIXTURES = ["service.ts", "component.tsx", "legacy.js", "models.py", "broken.ts"];

function renderGolden(analysis: FileAnalysis): string {
  const symbols = analysis.symbols.map(
    (symbol) =>
      `${symbol.handle} ${symbol.kind.padEnd(9)} ${symbol.exported ? "export" : "local "} ` +
      `L${symbol.startLine}-${symbol.endLine} body~${symbol.bodyTokens} ${symbol.qualifiedName} :: ${symbol.signature}`,
  );
  const imports = analysis.imports.map(
    (ref) =>
      `L${ref.line} ${ref.kind}${ref.typeOnly ? " type-only" : ""} ${ref.specifier}` +
      (ref.names.length > 0 ? ` { ${ref.names.join(", ")} }` : ""),
  );
  return [
    `# ${analysis.relPath} (${analysis.language})`,
    `syntax errors: ${analysis.hasSyntaxErrors}`,
    `tokens: raw ${analysis.rawTokens}, L1 ${analysis.l1Tokens}, L2 ${analysis.l2Tokens}`,
    "",
    "## L1",
    analysis.skeletonL1,
    "",
    "## L2",
    analysis.skeletonL2,
    "",
    "## Symbols",
    ...symbols,
    "",
    "## Imports",
    ...imports,
    "",
    "## Exports",
    analysis.exports.join(", "),
    "",
  ].join("\n");
}

describe("golden skeletons", () => {
  it.each(FIXTURES)("%s", async (fixture) => {
    const content = readFileSync(join(import.meta.dirname, "fixtures", fixture), "utf8");
    const analysis = analyzer.analyze(`fixtures/${fixture}`, content);
    expect(analysis).not.toBeNull();
    await expect(renderGolden(analysis as FileAnalysis)).toMatchFileSnapshot(
      join(import.meta.dirname, "__snapshots__", `${fixture}.golden.txt`),
    );
  });
});
