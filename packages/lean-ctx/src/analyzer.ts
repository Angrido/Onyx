import { defaultEstimator, type TokenEstimator } from "./estimator";
import { ExtractionContext } from "./extract/context";
import { extractEcmaScript } from "./extract/ecmascript";
import { extractImports } from "./extract/imports";
import { extractPython } from "./extract/python";
import { detectLanguage, type LanguageId } from "./languages";
import type { FileAnalysis, ImportRef, LeanSymbol, SkeletonLevel } from "./model";
import { ParserPool } from "./parser-pool";
import type { SkeletonPlan } from "./skeleton-plan";

export interface Excerpt {
  text: string;
  names: string[];
}

const MAX_EXCERPT_HOPS = 3;
const CALLABLE_KINDS = new Set<LeanSymbol["kind"]>(["function", "method"]);

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export interface LeanAnalyzerOptions {
  estimator?: TokenEstimator;
  parsers?: ParserPool;
}

function reexportNames(imports: readonly ImportRef[]): string[] {
  const names: string[] = [];
  for (const ref of imports) {
    if (ref.kind !== "reexport") continue;
    for (const name of ref.names) names.push(name === "*" ? `* from ${ref.specifier}` : name);
  }
  return names;
}

export class LeanAnalyzer {
  readonly estimator: TokenEstimator;
  private readonly parsers: ParserPool;

  constructor(options: LeanAnalyzerOptions = {}) {
    this.estimator = options.estimator ?? defaultEstimator;
    this.parsers = options.parsers ?? new ParserPool();
  }

  supports(relPath: string): boolean {
    return detectLanguage(relPath) !== null;
  }

  analyze(
    relPath: string,
    content: string,
    language = detectLanguage(relPath),
  ): FileAnalysis | null {
    if (language === null) return null;
    return this.analyzeAs(relPath, content, language);
  }

  excerpt(
    relPath: string,
    content: string,
    level: SkeletonLevel,
    names: readonly string[],
  ): Excerpt | null {
    const language = detectLanguage(relPath);
    if (language === null) return null;
    const { analysis, plan } = this.run(relPath, content, language);
    const topLevel = analysis.symbols.filter((symbol) => !symbol.qualifiedName.includes("."));
    const selected = new Map<string, LeanSymbol>();
    for (const symbol of topLevel)
      if (names.includes(symbol.name)) selected.set(symbol.name, symbol);
    if (selected.size === 0) return null;

    let frontier = [...selected.values()];
    for (let hop = 0; hop < MAX_EXCERPT_HOPS && frontier.length > 0; hop += 1) {
      const next: LeanSymbol[] = [];
      for (const symbol of frontier) {
        const text = CALLABLE_KINDS.has(symbol.kind)
          ? symbol.signature
          : content.slice(symbol.startOffset, symbol.endOffset);
        for (const candidate of topLevel) {
          if (selected.has(candidate.name) || CALLABLE_KINDS.has(candidate.kind)) continue;
          if (!new RegExp(`\\b${escapeRegExp(candidate.name)}\\b`).test(text)) continue;
          selected.set(candidate.name, candidate);
          next.push(candidate);
        }
      }
      frontier = next;
    }
    const ranges = [...selected.values()];
    const text = plan.render(content, level, (start, end) =>
      ranges.some((symbol) => start < symbol.endOffset && end > symbol.startOffset),
    );
    return { text, names: ranges.map((symbol) => symbol.name) };
  }

  private analyzeAs(relPath: string, content: string, language: LanguageId): FileAnalysis {
    return this.run(relPath, content, language).analysis;
  }

  private run(
    relPath: string,
    content: string,
    language: LanguageId,
  ): { analysis: FileAnalysis; plan: SkeletonPlan } {
    const tree = this.parsers.parse(language, content);
    const root = tree.rootNode;
    const ctx = new ExtractionContext(content, relPath, language, this.estimator);
    if (language === "python") extractPython(root, ctx);
    else extractEcmaScript(root, ctx);

    const imports = extractImports(language, root, this.parsers.importsQuery(language));
    const skeletonL1 = ctx.plan.render(content, 1);
    const skeletonL2 = ctx.plan.render(content, 2);
    const exports = [...new Set([...ctx.exports, ...reexportNames(imports)])];

    const analysis: FileAnalysis = {
      relPath,
      language,
      hasSyntaxErrors: root.hasError,
      symbols: ctx.symbols,
      imports,
      exports,
      skeletonL1,
      skeletonL2,
      rawTokens: this.estimator.estimate(content, language),
      l1Tokens: this.estimator.estimate(skeletonL1, language),
      l2Tokens: this.estimator.estimate(skeletonL2, language),
    };
    return { analysis, plan: ctx.plan };
  }
}
