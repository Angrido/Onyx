const MAX_DOC_LINE = 160;

export function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function truncate(text: string, maxLength: number): string {
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1)}…`;
}

export function isSingleLine(text: string): boolean {
  return !text.includes("\n");
}

export function isDocComment(text: string): boolean {
  return text.startsWith("/**") && !text.startsWith("/**/");
}

function firstMeaningfulLine(lines: readonly string[]): string | null {
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    if (trimmed.startsWith("@")) return null;
    return truncate(trimmed, MAX_DOC_LINE);
  }
  return null;
}

export function jsDocSummary(comment: string): string | null {
  const body = comment.replace(/^\/\*\*/, "").replace(/\*\/$/, "");
  const lines = body.split("\n").map((line) => line.replace(/^\s*\*?/, ""));
  return firstMeaningfulLine(lines);
}

export function pythonDocSummary(literal: string): string | null {
  const match = /^[rRbBuUfF]*("""|'''|"|')([\s\S]*?)\1$/.exec(literal.trim());
  if (!match?.[2]) return null;
  return firstMeaningfulLine(match[2].split("\n"));
}

export function tidySkeleton(text: string): string {
  return text
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0)
    .join("\n");
}

export function numberLines(content: string, startLine: number, endLine: number): string {
  const lines = content.split("\n");
  const first = Math.max(1, startLine);
  const last = Math.min(lines.length, endLine);
  const width = String(last).length;
  const output: string[] = [];
  for (let line = first; line <= last; line += 1) {
    output.push(`${String(line).padStart(width, " ")}  ${lines[line - 1] ?? ""}`);
  }
  return output.join("\n");
}
