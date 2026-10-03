import type { SkeletonLevel } from "./model";
import { tidySkeleton } from "./text";

export interface SourceSpan {
  startIndex: number;
  endIndex: number;
}

export type LevelReplacements = Partial<Record<SkeletonLevel, string>>;

interface Edit {
  start: number;
  end: number;
  replacements: LevelReplacements;
}

interface Range {
  start: number;
  end: number;
}

export const DROP: LevelReplacements = { 1: "", 2: "" };

export class SkeletonPlan {
  private readonly kept: Range[] = [];
  private readonly edits: Edit[] = [];

  keep(span: SourceSpan): void {
    this.kept.push({ start: span.startIndex, end: span.endIndex });
  }

  replace(start: number, end: number, replacements: LevelReplacements): void {
    this.edits.push({ start, end, replacements });
  }

  replaceSpan(span: SourceSpan, replacements: LevelReplacements): void {
    this.replace(span.startIndex, span.endIndex, replacements);
  }

  drop(span: SourceSpan): void {
    this.replaceSpan(span, DROP);
  }

  render(
    source: string,
    level: SkeletonLevel,
    include: (start: number, end: number) => boolean = () => true,
  ): string {
    const edits = this.edits
      .filter((edit) => edit.replacements[level] !== undefined)
      .sort((a, b) => a.start - b.start || b.end - a.end);
    const ranges = this.kept
      .filter((range) => include(range.start, range.end))
      .sort((a, b) => a.start - b.start);
    const blocks: string[] = [];
    let editIndex = 0;

    for (const range of ranges) {
      let cursor = range.start;
      let text = "";
      while (editIndex < edits.length && (edits[editIndex]?.start ?? 0) < range.start)
        editIndex += 1;
      while (editIndex < edits.length) {
        const edit = edits[editIndex];
        if (!edit || edit.start >= range.end) break;
        editIndex += 1;
        if (edit.start < cursor || edit.end > range.end) continue;
        text += source.slice(cursor, edit.start) + (edit.replacements[level] ?? "");
        cursor = edit.end;
      }
      text += source.slice(cursor, range.end);
      blocks.push(text);
    }
    return tidySkeleton(blocks.join("\n"));
  }
}
