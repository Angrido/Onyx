import type { LanguageId } from "./languages";

export type SymbolKind =
  "function" | "method" | "class" | "interface" | "type" | "enum" | "variable" | "namespace";

export type ContextLevel = 0 | 1 | 2 | 3;

export type SkeletonLevel = 1 | 2;

export interface LeanSymbol {
  handle: string;
  name: string;
  qualifiedName: string;
  kind: SymbolKind;
  signature: string;
  startOffset: number;
  endOffset: number;
  startLine: number;
  endLine: number;
  bodyTokens: number;
  exported: boolean;
}

export type ImportKind = "static" | "dynamic" | "require" | "reexport";

export interface ImportRef {
  specifier: string;
  kind: ImportKind;
  typeOnly: boolean;
  names: string[];
  line: number;
}

export interface FileAnalysis {
  relPath: string;
  language: LanguageId;
  hasSyntaxErrors: boolean;
  symbols: LeanSymbol[];
  imports: ImportRef[];
  exports: string[];
  skeletonL1: string;
  skeletonL2: string;
  rawTokens: number;
  l1Tokens: number;
  l2Tokens: number;
}
