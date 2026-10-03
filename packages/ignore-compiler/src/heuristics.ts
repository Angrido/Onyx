import { ContextPolicy } from "./policy";
import { rule, type PolicyRule } from "./rules";

export interface FileStat {
  relPath: string;
  sizeBytes: number;
  rawTokens: number;
  binary: boolean;
  centrality: number;
}

export interface Suggestion {
  rule: PolicyRule;
  files: number;
  tokens: number;
  centralFiles: string[];
}

export interface SuggestOptions {
  dataThresholdBytes?: number;
  centralityShare?: number;
}

const DATA_EXTENSIONS = new Set([
  "json",
  "csv",
  "tsv",
  "sql",
  "xml",
  "yaml",
  "yml",
  "ndjson",
  "jsonl",
  "txt",
]);
const GENERATED_PATH = /(^|\/)(__generated__|generated|gen)\//;
const GENERATED_FILE = /(\.generated\.|\.gen\.|_pb2\.py$|\.pb\.go$|_pb\.ts$)/;
const DEFAULT_DATA_THRESHOLD = 200 * 1024;
const DEFAULT_CENTRALITY_SHARE = 0.05;

function extensionOf(relPath: string): string {
  const name = relPath.slice(relPath.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? "" : name.slice(dot + 1).toLowerCase();
}

function assetRoot(relPath: string): string {
  const segments = relPath.split("/").slice(0, -1);
  return segments.slice(0, Math.min(2, segments.length)).join("/");
}

export function centralityThreshold(
  stats: readonly FileStat[],
  share = DEFAULT_CENTRALITY_SHARE,
): number {
  const ranked = stats
    .map((stat) => stat.centrality)
    .filter((value) => value > 0)
    .sort((a, b) => b - a);
  if (ranked.length === 0) return Number.POSITIVE_INFINITY;
  const index = Math.max(0, Math.ceil(ranked.length * share) - 1);
  return ranked[index] ?? Number.POSITIVE_INFINITY;
}

export function measureRule(
  candidate: PolicyRule,
  stats: readonly FileStat[],
  threshold: number,
  current: ContextPolicy = new ContextPolicy([]),
): Suggestion & { redundant: boolean } {
  const policy = new ContextPolicy([{ ...candidate, action: "EXCLUDE" }]);
  let files = 0;
  let tokens = 0;
  let alreadyExcluded = 0;
  const centralFiles: string[] = [];
  for (const stat of stats) {
    if (!policy.isExcluded(stat.relPath)) continue;
    files += 1;
    tokens += stat.rawTokens;
    if (current.isExcluded(stat.relPath)) alreadyExcluded += 1;
    if (stat.centrality >= threshold) centralFiles.push(stat.relPath);
  }
  return {
    rule: candidate,
    files,
    tokens,
    centralFiles,
    redundant: files > 0 && alreadyExcluded === files,
  };
}

export function suggestRules(
  stats: readonly FileStat[],
  existing: readonly PolicyRule[],
  base: readonly PolicyRule[],
  options: SuggestOptions = {},
): Suggestion[] {
  const threshold = centralityThreshold(stats, options.centralityShare);
  const current = new ContextPolicy(existing);
  const seen = new Set(existing.map((candidate) => `${candidate.action}:${candidate.pattern}`));
  const candidates: PolicyRule[] = [...base];

  const assets = new Map<string, number>();
  for (const stat of stats) {
    if (!stat.binary) continue;
    const extension = extensionOf(stat.relPath);
    if (extension.length === 0) continue;
    const root = assetRoot(stat.relPath);
    const pattern = root.length === 0 ? `*.${extension}` : `${root}/**/*.${extension}`;
    assets.set(pattern, (assets.get(pattern) ?? 0) + 1);
  }
  for (const pattern of [...assets.keys()].sort()) {
    candidates.push(rule(pattern, { source: "HEURISTIC", reason: "Binary assets" }));
  }

  const dataThreshold = options.dataThresholdBytes ?? DEFAULT_DATA_THRESHOLD;
  for (const stat of stats) {
    if (stat.binary || stat.sizeBytes < dataThreshold) continue;
    if (!DATA_EXTENSIONS.has(extensionOf(stat.relPath))) continue;
    candidates.push(
      rule(`/${stat.relPath}`, {
        source: "HEURISTIC",
        reason: `Large data file (${Math.round(stat.sizeBytes / 1024)} KB)`,
      }),
    );
  }

  const generatedRoots = new Set<string>();
  for (const stat of stats) {
    const match = GENERATED_PATH.exec(stat.relPath);
    if (match) generatedRoots.add(stat.relPath.slice(0, (match.index ?? 0) + match[0].length));
    else if (GENERATED_FILE.test(stat.relPath)) generatedRoots.add(stat.relPath);
  }
  for (const root of [...generatedRoots].sort()) {
    candidates.push(rule(`/${root}`, { source: "HEURISTIC", reason: "Generated code" }));
  }

  const suggestions: Suggestion[] = [];
  for (const candidate of candidates) {
    const key = `${candidate.action}:${candidate.pattern}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const { redundant, ...measured } = measureRule(candidate, stats, threshold, current);
    if (redundant) continue;
    if (candidate.source === "HEURISTIC" && measured.files === 0) continue;
    suggestions.push(measured);
  }
  return suggestions.sort(
    (a, b) => b.tokens - a.tokens || a.rule.pattern.localeCompare(b.rule.pattern),
  );
}
