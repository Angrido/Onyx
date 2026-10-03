import type { TokenEstimator } from "./estimator";
import { numberLines } from "./text";

export interface MapEntry {
  relPath: string;
  tokens: number;
  exports: readonly string[];
  rank?: number;
}

export interface ProjectMap {
  text: string;
  tokens: number;
  includedFiles: number;
  omittedFiles: number;
}

export interface ProjectMapOptions {
  budgetTokens: number;
  estimator: TokenEstimator;
  maxExportsPerFile?: number;
}

const DEFAULT_MAX_EXPORTS = 8;

export function formatTokenCount(tokens: number): string {
  if (tokens < 1_000) return String(tokens);
  if (tokens < 10_000) return `${(tokens / 1_000).toFixed(1)}k`;
  return `${Math.round(tokens / 1_000)}k`;
}

function dirname(relPath: string): string {
  const slash = relPath.lastIndexOf("/");
  return slash < 0 ? "" : relPath.slice(0, slash + 1);
}

function basename(relPath: string): string {
  return relPath.slice(relPath.lastIndexOf("/") + 1);
}

export function describeEntry(entry: MapEntry, maxExports = DEFAULT_MAX_EXPORTS): string {
  const shown = entry.exports.slice(0, maxExports);
  const hidden = entry.exports.length - shown.length;
  const exportText =
    shown.length === 0 ? "" : `: ${shown.join(", ")}${hidden > 0 ? `, +${hidden}` : ""}`;
  return `${basename(entry.relPath)} ~${formatTokenCount(entry.tokens)}${exportText}`;
}

export function renderMapLine(entry: MapEntry, maxExports = DEFAULT_MAX_EXPORTS): string {
  return `${dirname(entry.relPath)}${describeEntry(entry, maxExports)}`;
}

function renderGrouped(
  included: readonly MapEntry[],
  omitted: ReadonlyMap<string, number>,
  maxExports: number,
): string {
  const directories = new Map<string, MapEntry[]>();
  for (const entry of included) {
    const dir = dirname(entry.relPath);
    const list = directories.get(dir) ?? [];
    list.push(entry);
    directories.set(dir, list);
  }
  for (const dir of omitted.keys()) if (!directories.has(dir)) directories.set(dir, []);

  const lines: string[] = [];
  for (const dir of [...directories.keys()].sort()) {
    const entries = (directories.get(dir) ?? []).sort((a, b) => a.relPath.localeCompare(b.relPath));
    const hidden = omitted.get(dir) ?? 0;
    const header = dir.length === 0 ? "./" : dir;
    lines.push(hidden > 0 ? `${header} (+${hidden} more)` : header);
    for (const entry of entries) lines.push(`  ${describeEntry(entry, maxExports)}`);
  }
  return lines.join("\n");
}

export function renderProjectMap(
  entries: readonly MapEntry[],
  options: ProjectMapOptions,
): ProjectMap {
  const maxExports = options.maxExportsPerFile ?? DEFAULT_MAX_EXPORTS;
  const ranked = [...entries].sort(
    (a, b) => (b.rank ?? 0) - (a.rank ?? 0) || a.relPath.localeCompare(b.relPath),
  );
  const included: MapEntry[] = [];
  const omitted = new Map<string, number>();
  const seenDirectories = new Set<string>();
  let spent = 0;

  for (const entry of ranked) {
    const dir = dirname(entry.relPath);
    const line = `  ${describeEntry(entry, maxExports)}\n`;
    const header = seenDirectories.has(dir) ? "" : `${dir}\n`;
    const cost = options.estimator.estimate(header + line, "text");
    if (spent + cost <= options.budgetTokens) {
      included.push(entry);
      seenDirectories.add(dir);
      spent += cost;
    } else {
      omitted.set(dir, (omitted.get(dir) ?? 0) + 1);
    }
  }

  const text = renderGrouped(included, omitted, maxExports);
  return {
    text,
    tokens: options.estimator.estimate(text, "text"),
    includedFiles: included.length,
    omittedFiles: entries.length - included.length,
  };
}

export interface SymbolSourceOptions {
  maxLines?: number;
}

const DEFAULT_MAX_SYMBOL_LINES = 400;

export function renderSymbolSource(
  content: string,
  startLine: number,
  endLine: number,
  options: SymbolSourceOptions = {},
): { text: string; truncated: boolean } {
  const maxLines = options.maxLines ?? DEFAULT_MAX_SYMBOL_LINES;
  const lastLine = Math.min(endLine, startLine + maxLines - 1);
  return { text: numberLines(content, startLine, lastLine), truncated: lastLine < endLine };
}
