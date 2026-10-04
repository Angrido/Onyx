import type {
  FindingCategory,
  FindingSeverity,
  FindingVerdict,
  InsightIntent,
  InsightMode,
} from "@onyx/contracts";

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
  DEFINITION: "Definition",
  USAGES: "Usages",
  IMPORTERS: "Imported by",
  IMPORTS: "Imports",
  CENTRAL: "Central files",
  LARGEST: "Largest files",
  CYCLES: "Import cycles",
  OPEN: "Open question",
};

export const MODE_LABELS: Record<InsightMode, string> = {
  INDEX: "From the index · free",
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

export const CATEGORY_LABELS: Record<FindingCategory, string> = {
  SECURITY: "Security",
  PERFORMANCE: "Performance",
  MAINTAINABILITY: "Maintainability",
  DEPENDENCY: "Dependencies",
};

export const VERDICT_LABELS: Record<FindingVerdict, string> = {
  REAL: "Claude: real",
  FALSE_POSITIVE: "Claude: false positive",
  UNSURE: "Claude: unsure",
};

export const VERDICT_TONES: Record<FindingVerdict, Tone> = {
  REAL: "danger",
  FALSE_POSITIVE: "success",
  UNSURE: "warning",
};

export const EXAMPLE_QUESTIONS = [
  "Which are the most central files?",
  "Are there circular imports?",
  "Where is `main` used?",
];
