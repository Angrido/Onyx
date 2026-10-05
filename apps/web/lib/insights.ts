import type {
  FindingCategory,
  FindingSeverity,
  FindingVerdict,
  InsightIntent,
  InsightMode,
} from "@onyx/contracts";
import { msg } from "@/lib/i18n/core";

type Tone = "neutral" | "primary" | "success" | "warning" | "danger" | "scout";

export type InlinePart = { kind: "text" | "code" | "strong"; text: string };
export type AnswerBlock =
  | { kind: "paragraph"; parts: InlinePart[] }
  | { kind: "note"; parts: InlinePart[] }
  | { kind: "list"; items: InlinePart[][] };

export function inlineParts(text: string): InlinePart[] {
  const parts: InlinePart[] = [];
  for (const [index, chunk] of text.split("`").entries()) {
    if (chunk.length === 0) continue;
    if (index % 2 === 1) {
      parts.push({ kind: "code", text: chunk });
      continue;
    }
    for (const [inner, piece] of chunk.split("**").entries()) {
      if (piece.length > 0) parts.push({ kind: inner % 2 === 1 ? "strong" : "text", text: piece });
    }
  }
  return parts;
}

export function answerBlocks(text: string): AnswerBlock[] {
  const blocks: AnswerBlock[] = [];
  for (const raw of text.replace(/\r\n?/g, "\n").split(/\n{2,}/)) {
    const lines = raw.split("\n").filter((line) => line.trim().length > 0);
    if (lines.length === 0) continue;
    if (lines.every((line) => /^\s*[-*] /.test(line))) {
      blocks.push({
        kind: "list",
        items: lines.map((line) => inlineParts(line.replace(/^\s*[-*] /, ""))),
      });
      continue;
    }
    const joined = lines.join(" ").trim();
    const note = /^_(.+)_$/.exec(joined);
    blocks.push(
      note
        ? { kind: "note", parts: inlineParts(note[1] ?? "") }
        : { kind: "paragraph", parts: inlineParts(joined.replace(/^#+\s*/, "")) },
    );
  }
  return blocks;
}

export const INTENT_LABELS: Record<InsightIntent, string> = {
  DEFINITION: msg("Definition"),
  USAGES: msg("Usages"),
  IMPORTERS: msg("Imported by"),
  IMPORTS: msg("Imports"),
  CENTRAL: msg("Central files"),
  LARGEST: msg("Largest files"),
  CYCLES: msg("Import cycles"),
  OPEN: msg("Open question"),
};

export const MODE_LABELS: Record<InsightMode, string> = {
  INDEX: msg("From the index · free"),
  MODEL: "Claude",
};

export const MODE_TONES: Record<InsightMode, Tone> = {
  INDEX: "success",
  MODEL: "scout",
};

export const SEVERITY_TONES: Record<FindingSeverity, Tone> = {
  HIGH: "danger",
  MEDIUM: "warning",
  LOW: "neutral",
};

export const SEVERITY_LABELS: Record<FindingSeverity, string> = {
  HIGH: msg("high"),
  MEDIUM: msg("medium"),
  LOW: msg("low"),
};

export const CATEGORY_LABELS: Record<FindingCategory, string> = {
  SECURITY: msg("Security"),
  PERFORMANCE: msg("Performance"),
  MAINTAINABILITY: msg("Maintainability"),
  DEPENDENCY: msg("Dependencies"),
};

export const VERDICT_LABELS: Record<FindingVerdict, string> = {
  REAL: msg("Claude: real"),
  FALSE_POSITIVE: msg("Claude: false positive"),
  UNSURE: msg("Claude: unsure"),
};

export const VERDICT_TONES: Record<FindingVerdict, Tone> = {
  REAL: "danger",
  FALSE_POSITIVE: "success",
  UNSURE: "warning",
};

export const EXAMPLE_QUESTIONS = [
  msg("Which are the most central files?"),
  msg("Are there circular imports?"),
  msg("Where is `main` used?"),
];
