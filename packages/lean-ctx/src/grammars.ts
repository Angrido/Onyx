import { createRequire } from "node:module";
import type Parser from "tree-sitter";
import type { LanguageId } from "./languages";

const requireNative = createRequire(import.meta.url);

interface TypeScriptGrammars {
  typescript: Parser.Language;
  tsx: Parser.Language;
}

const GRAMMAR_PACKAGES = [
  "tree-sitter",
  "tree-sitter-typescript",
  "tree-sitter-javascript",
  "tree-sitter-python",
] as const;

export const EXTRACTOR_REVISION = 1;

export function loadGrammar(language: LanguageId): Parser.Language {
  switch (language) {
    case "typescript":
      return (requireNative("tree-sitter-typescript") as TypeScriptGrammars).typescript;
    case "tsx":
      return (requireNative("tree-sitter-typescript") as TypeScriptGrammars).tsx;
    case "javascript":
      return requireNative("tree-sitter-javascript") as Parser.Language;
    case "python":
      return requireNative("tree-sitter-python") as Parser.Language;
  }
}

export function loadParserConstructor(): typeof Parser {
  return requireNative("tree-sitter") as typeof Parser;
}

export function grammarVersions(): Record<string, string> {
  const versions: Record<string, string> = {};
  for (const name of GRAMMAR_PACKAGES) {
    const manifest = requireNative(`${name}/package.json`) as { version: string };
    versions[name] = manifest.version;
  }
  return versions;
}

let cachedAnalyzerVersion: string | null = null;

export function analyzerVersion(): string {
  if (cachedAnalyzerVersion === null) {
    const versions = grammarVersions();
    const parts = GRAMMAR_PACKAGES.map(
      (name) => `${name.replace("tree-sitter-", "")}@${versions[name]}`,
    );
    cachedAnalyzerVersion = `lean-ctx.${EXTRACTOR_REVISION}+${parts.join("+")}`;
  }
  return cachedAnalyzerVersion;
}
