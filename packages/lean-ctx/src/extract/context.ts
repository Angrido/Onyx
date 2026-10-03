import type Parser from "tree-sitter";
import type { TokenEstimator } from "../estimator";
import { symbolHandle } from "../handles";
import type { LanguageId } from "../languages";
import type { LeanSymbol, SymbolKind } from "../model";
import { SkeletonPlan, type LevelReplacements } from "../skeleton-plan";
import { collapseWhitespace, truncate } from "../text";

export type SyntaxNode = Parser.SyntaxNode;

const MAX_SIGNATURE_LENGTH = 300;

export interface SymbolDraft {
  name: string;
  qualifiedName: string;
  kind: SymbolKind;
  signature: string;
  extent: SyntaxNode;
  extentStart?: SyntaxNode;
  body: string | null;
  exported: boolean;
}

export class ExtractionContext {
  readonly plan = new SkeletonPlan();
  private readonly registry: LeanSymbol[] = [];
  private readonly indexByName = new Map<string, number>();
  private readonly exportList = new Set<string>();
  private readonly handledComments = new Set<number>();

  constructor(
    readonly source: string,
    readonly relPath: string,
    readonly language: LanguageId,
    private readonly estimator: TokenEstimator,
  ) {}

  get symbols(): LeanSymbol[] {
    return [...this.registry];
  }

  get exports(): string[] {
    return [...this.exportList];
  }

  addExport(name: string): void {
    this.exportList.add(name);
  }

  register(draft: SymbolDraft): string {
    const bodyTokens = draft.body === null ? 0 : this.estimator.estimate(draft.body, this.language);
    const existingIndex = this.indexByName.get(draft.qualifiedName);
    const existing = existingIndex === undefined ? undefined : this.registry[existingIndex];
    if (existingIndex !== undefined && existing) {
      if (draft.body === null) return existing.handle;
      if (existing.bodyTokens === 0) {
        const replacement = this.build(draft, draft.qualifiedName, bodyTokens);
        this.registry[existingIndex] = {
          ...replacement,
          startOffset: Math.min(existing.startOffset, replacement.startOffset),
          startLine: Math.min(existing.startLine, replacement.startLine),
        };
        return replacement.handle;
      }
    }
    const qualifiedName =
      existingIndex === undefined ? draft.qualifiedName : this.nextFreeName(draft.qualifiedName);
    const symbol = this.build(draft, qualifiedName, bodyTokens);
    this.indexByName.set(qualifiedName, this.registry.length);
    this.registry.push(symbol);
    if (symbol.exported && !qualifiedName.includes(".")) this.addExport(draft.name);
    return symbol.handle;
  }

  signature(start: number, end: number): string {
    const text = collapseWhitespace(this.source.slice(start, end)).replace(/\s*[=:{]$/, "");
    return truncate(text, MAX_SIGNATURE_LENGTH);
  }

  valueStart(value: SyntaxNode): number {
    let start = value.startIndex;
    while (start > 0 && /\s/.test(this.source[start - 1] ?? "")) start -= 1;
    return start;
  }

  markComment(comment: SyntaxNode, replacements: LevelReplacements): void {
    this.handledComments.add(comment.id);
    this.plan.replaceSpan(comment, replacements);
  }

  isCommentHandled(comment: SyntaxNode): boolean {
    return this.handledComments.has(comment.id);
  }

  private nextFreeName(qualifiedName: string): string {
    let ordinal = 2;
    while (this.indexByName.has(`${qualifiedName}~${ordinal}`)) ordinal += 1;
    return `${qualifiedName}~${ordinal}`;
  }

  private build(draft: SymbolDraft, qualifiedName: string, bodyTokens: number): LeanSymbol {
    const start = draft.extentStart ?? draft.extent;
    return {
      handle: symbolHandle(this.relPath, qualifiedName),
      name: draft.name,
      qualifiedName,
      kind: draft.kind,
      signature: draft.signature,
      startOffset: start.startIndex,
      endOffset: draft.extent.endIndex,
      startLine: start.startPosition.row + 1,
      endLine: draft.extent.endPosition.row + 1,
      bodyTokens,
      exported: draft.exported,
    };
  }
}
