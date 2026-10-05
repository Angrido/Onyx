import { createHash } from "node:crypto";
import {
  describeEntry,
  PLACEHOLDER_LEGEND,
  type ContextLevel,
  type Excerpt,
  type SkeletonLevel,
  type TokenEstimator,
} from "@onyx/lean-ctx";
import type { DependencyGraph } from "./graph";
import { effectiveDependencies, type EffectiveDependency } from "./barrels";

export interface PackFile {
  relPath: string;
  language: string | null;
  rawTokens: number;
  l1Tokens: number | null;
  l2Tokens: number | null;
  skeletonL1: string | null;
  skeletonL2: string | null;
  exports: readonly string[];
  typeNames: readonly string[];
  sensitive: boolean;
}

export type PackRole = "target" | "dependency" | "dependent" | "nearby";

export interface PackEntry {
  relPath: string;
  role: PackRole;
  distance: number;
  level: ContextLevel;
  tokens: number;
  symbols: string[] | null;
  fingerprint: string;
  reused: boolean;
}

export interface ContextPack {
  text: string;
  entries: PackEntry[];
  omitted: string[];
  baselineTokens: number;
  deliveredTokens: number;
  reusedTokens: number;
  signatureSavedTokens: number;
  budgetTokens: number;
}

export interface ContextPackInput {
  targets: readonly string[];
  graph: DependencyGraph;
  files: ReadonlyMap<string, PackFile>;
  readSource: (relPath: string) => string | null;
  rank: ReadonlyMap<string, number>;
  estimator: TokenEstimator;
  budgetTokens?: number;
  excerpt?: (relPath: string, level: SkeletonLevel, names: readonly string[]) => Excerpt | null;
  delivered?: ReadonlyMap<string, string>;
  signatureTargets?: ReadonlySet<string>;
}

export function packFingerprint(level: ContextLevel, content: string): string {
  return createHash("sha256").update(`${level}\0${content}`).digest("hex").slice(0, 16);
}

export const DEFAULT_PACK_BUDGET = 24_000;

const TARGET_SHARE = 0.6;
const SMALL_FILE_TOKENS = 300;
const MAX_NEARBY = 12;
const MAX_DETAILED_DEPENDENTS = 8;
const MAX_USAGE_LINES = 8;
const MAX_USAGE_LINE_LENGTH = 160;
const FENCE_LANGUAGES: Readonly<Record<string, string>> = {
  typescript: "ts",
  tsx: "tsx",
  javascript: "js",
  python: "py",
  json: "json",
  css: "css",
  yaml: "yaml",
  markdown: "md",
  sql: "sql",
  prisma: "prisma",
};

const SECTION_TITLES: Readonly<Record<Exclude<PackRole, "nearby">, string>> = {
  target: "Targets",
  dependency: "Direct dependencies (imported by the targets)",
  dependent: "Direct dependents: where the targets are used",
};

const LEVEL_LABELS: Readonly<Record<ContextLevel, string>> = {
  0: "map",
  1: "signatures",
  2: "contracts",
  3: "full source",
};

interface Candidate {
  relPath: string;
  role: PackRole;
  distance: number;
  plannedLevel: ContextLevel;
  names: readonly string[];
}

function fence(content: string): string {
  let ticks = "```";
  while (content.includes(ticks)) ticks += "`";
  return ticks;
}

const OPAQUE_IMPORTS = new Set(["*", "default"]);

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function usageExcerpt(
  file: PackFile,
  candidate: Candidate,
  input: ContextPackInput,
): { content: string; symbols: string[] | null } | null {
  const names = candidate.names.filter((name) => !OPAQUE_IMPORTS.has(name));
  if (names.length === 0) return null;
  const source = input.readSource(file.relPath);
  if (source === null) return null;
  const pattern = new RegExp(`(^|[^\\w$])(${names.map(escapeRegExp).join("|")})(?![\\w$])`);
  const lines: string[] = [];
  let hidden = 0;
  source.split("\n").forEach((line, index) => {
    const trimmed = line.trim();
    if (!pattern.test(line) || /^(import|from)\s|^export\s.*\sfrom\s/.test(trimmed)) return;
    if (lines.length >= MAX_USAGE_LINES) {
      hidden += 1;
      return;
    }
    const text =
      trimmed.length > MAX_USAGE_LINE_LENGTH
        ? `${trimmed.slice(0, MAX_USAGE_LINE_LENGTH - 1)}…`
        : trimmed;
    lines.push(`${index + 1}: ${text}`);
  });
  if (lines.length === 0) return null;
  if (hidden > 0) lines.push(`… ${hidden} more`);
  return { content: lines.join("\n"), symbols: names };
}

function contentAt(
  file: PackFile,
  candidate: Candidate,
  level: ContextLevel,
  input: ContextPackInput,
): { content: string; symbols: string[] | null } | null {
  if (file.sensitive && level > 0) return null;
  switch (level) {
    case 3: {
      const content = input.readSource(file.relPath);
      return content === null ? null : { content, symbols: null };
    }
    case 2:
    case 1: {
      if (candidate.role === "dependent") return usageExcerpt(file, candidate, input);
      const names = candidate.names.filter((name) => !OPAQUE_IMPORTS.has(name));
      if (
        candidate.role === "dependency" &&
        names.length === candidate.names.length &&
        names.length > 0
      ) {
        const excerpt = input.excerpt?.(file.relPath, level, names) ?? null;
        if (excerpt !== null && excerpt.text.length > 0) {
          return { content: excerpt.text, symbols: excerpt.names };
        }
      }
      const skeleton = level === 2 ? file.skeletonL2 : file.skeletonL1;
      return skeleton === null ? null : { content: skeleton, symbols: null };
    }
    case 0:
      return {
        content: describeEntry({
          relPath: file.relPath,
          tokens: file.rawTokens,
          exports: file.exports,
        }),
        symbols: null,
      };
  }
}

function levelsToTry(file: PackFile, candidate: Candidate, budget: number): ContextLevel[] {
  if (candidate.role === "target" && file.rawTokens > budget * TARGET_SHARE) return [2, 1, 0];
  if (file.skeletonL1 === null && candidate.role !== "nearby") {
    return file.rawTokens <= SMALL_FILE_TOKENS || candidate.role === "target" ? [3, 0] : [0];
  }
  return ([3, 2, 1, 0] as ContextLevel[]).filter((level) => level <= candidate.plannedLevel);
}

function dependencyLevel(
  file: PackFile | undefined,
  dependency: EffectiveDependency,
): ContextLevel {
  if (!file) return 1;
  if (dependency.typeOnly) return 2;
  return dependency.names.some((name) => file.typeNames.includes(name)) ? 2 : 1;
}

function collectCandidates(input: ContextPackInput, targets: readonly string[]): Candidate[] {
  const candidates: Candidate[] = targets.map((relPath) => ({
    relPath,
    role: "target",
    distance: 0,
    plannedLevel: input.signatureTargets?.has(relPath) ? 2 : 3,
    names: [],
  }));
  const seen = new Set(targets);
  const exportsOf = (relPath: string) => input.files.get(relPath)?.exports;
  const rankOf = (relPath: string) => input.rank.get(relPath) ?? 0;
  const fresh = (relPath: string) => !seen.has(relPath) && input.files.has(relPath);
  const byRank = (a: string, b: string) => rankOf(b) - rankOf(a) || a.localeCompare(b);

  const dependencies = new Map<string, EffectiveDependency>();
  for (const target of targets) {
    for (const dependency of effectiveDependencies(input.graph, exportsOf, target)) {
      if (!fresh(dependency.relPath)) continue;
      const current = dependencies.get(dependency.relPath);
      dependencies.set(dependency.relPath, {
        relPath: dependency.relPath,
        names: [...new Set([...(current?.names ?? []), ...dependency.names])],
        typeOnly: (current?.typeOnly ?? true) && dependency.typeOnly,
      });
    }
  }
  for (const relPath of [...dependencies.keys()].sort(byRank)) {
    seen.add(relPath);
    const dependency = dependencies.get(relPath);
    candidates.push({
      relPath,
      role: "dependency",
      distance: 1,
      plannedLevel: dependency ? dependencyLevel(input.files.get(relPath), dependency) : 1,
      names: dependency?.names ?? [],
    });
  }

  const targetSet = new Set(targets);
  const dependents = [...new Set(targets.flatMap((target) => input.graph.dependents(target)))]
    .filter(fresh)
    .sort(byRank);
  dependents.forEach((relPath, position) => {
    seen.add(relPath);
    const names = effectiveDependencies(input.graph, exportsOf, relPath)
      .filter((dependency) => targetSet.has(dependency.relPath))
      .flatMap((dependency) => dependency.names);
    candidates.push({
      relPath,
      role: "dependent",
      distance: 1,
      plannedLevel: position < MAX_DETAILED_DEPENDENTS ? 1 : 0,
      names: [...new Set(names)],
    });
  });

  const firstRing = [...dependencies.keys(), ...dependents];
  const secondRing = [
    ...new Set(
      firstRing.flatMap((node) => [
        ...effectiveDependencies(input.graph, exportsOf, node).map(
          (dependency) => dependency.relPath,
        ),
        ...input.graph.dependents(node),
      ]),
    ),
  ]
    .filter((relPath) => fresh(relPath) && !input.graph.isBarrel(relPath))
    .sort(byRank)
    .slice(0, MAX_NEARBY);
  for (const relPath of secondRing) {
    seen.add(relPath);
    candidates.push({ relPath, role: "nearby", distance: 2, plannedLevel: 0, names: [] });
  }
  return candidates;
}

function dirPrefix(relPath: string): string {
  return relPath.slice(0, relPath.lastIndexOf("/") + 1);
}

function render(
  sections: Map<PackRole, { entry: PackEntry; content: string }[]>,
  files: ReadonlyMap<string, PackFile>,
): { text: string; framing: string } {
  const lines: string[] = [
    "# Onyx context pack",
    "Files around the task targets in the import graph: full source for targets, contracts or signatures for direct neighbours, a map line for files two hops away.",
    PLACEHOLDER_LEGEND,
  ];
  const framing: string[] = [...lines];
  const push = (line: string, isFraming: boolean) => {
    lines.push(line);
    if (isFraming) framing.push(line);
  };

  const reused = [...sections.values()].flat().filter(({ entry }) => entry.reused);
  for (const role of ["target", "dependency", "dependent"] as const) {
    const items = (sections.get(role) ?? []).filter(({ entry }) => !entry.reused);
    if (items.length === 0) continue;
    push("", true);
    push(`## ${SECTION_TITLES[role]}`, true);
    for (const { entry, content } of items) {
      if (entry.level === 0) {
        push(`- ${dirPrefix(entry.relPath)}${content}`, false);
        continue;
      }
      const language = FENCE_LANGUAGES[files.get(entry.relPath)?.language ?? ""] ?? "";
      const ticks = fence(content);
      push("", true);
      const scope = entry.symbols === null ? "" : `: ${entry.symbols.join(", ")}`;
      const label = role === "dependent" ? "usages" : LEVEL_LABELS[entry.level];
      push(`### ${entry.relPath} (${label}${scope})`, true);
      push(`${ticks}${language}`, true);
      push(content, false);
      push(ticks, true);
    }
  }
  const nearby = (sections.get("nearby") ?? []).filter(({ entry }) => !entry.reused);
  if (nearby.length > 0) {
    push("", true);
    push("## Nearby files (two hops away)", true);
    for (const { entry, content } of nearby) push(`- ${dirPrefix(entry.relPath)}${content}`, false);
  }
  if (reused.length > 0) {
    push("", true);
    push("## Already sent earlier in this conversation, unchanged", true);
    for (const { entry } of reused)
      push(
        `- ${entry.relPath} (${entry.role === "dependent" ? "usages" : LEVEL_LABELS[entry.level]})`,
        true,
      );
  }
  return { text: lines.join("\n"), framing: framing.join("\n") };
}

export function buildContextPack(input: ContextPackInput): ContextPack | null {
  const budget = input.budgetTokens ?? DEFAULT_PACK_BUDGET;
  const targets = [...new Set(input.targets)].filter((target) => input.files.has(target));
  if (targets.length === 0) return null;

  const candidates = collectCandidates(input, targets);
  const sections = new Map<PackRole, { entry: PackEntry; content: string }[]>();
  const entries: PackEntry[] = [];
  const omitted: string[] = [];
  let spent = 0;

  for (const candidate of candidates) {
    const file = input.files.get(candidate.relPath);
    if (!file) continue;
    let placed = false;
    for (const level of levelsToTry(file, candidate, budget)) {
      const resolved = contentAt(file, candidate, level, input);
      if (resolved === null || resolved.content.length === 0) continue;
      const content = resolved.content;
      const tokens = input.estimator.estimate(content, level === 0 ? "text" : file.language);
      if (spent + tokens > budget && candidate.role !== "target") continue;
      const fingerprint = packFingerprint(level, content);
      const entry: PackEntry = {
        relPath: candidate.relPath,
        role: candidate.role,
        distance: candidate.distance,
        level,
        tokens,
        symbols: resolved.symbols,
        fingerprint,
        reused: input.delivered?.get(candidate.relPath) === fingerprint,
      };
      entries.push(entry);
      const section = sections.get(candidate.role) ?? [];
      section.push({ entry, content });
      sections.set(candidate.role, section);
      spent += tokens;
      placed = true;
      break;
    }
    if (!placed) omitted.push(candidate.relPath);
  }

  const { text, framing } = render(sections, input.files);
  const baselineTokens = candidates
    .filter((candidate) => candidate.role === "target" || candidate.role === "dependency")
    .reduce((sum, candidate) => sum + (input.files.get(candidate.relPath)?.rawTokens ?? 0), 0);
  const deliveredTokens =
    entries.reduce((sum, entry) => sum + (entry.reused ? 0 : entry.tokens), 0) +
    input.estimator.estimate(framing, "text");
  const reusedTokens = entries.reduce((sum, entry) => sum + (entry.reused ? entry.tokens : 0), 0);
  const signatureSavedTokens = entries
    .filter(
      (entry) =>
        entry.role === "target" && entry.level < 3 && input.signatureTargets?.has(entry.relPath),
    )
    .reduce(
      (sum, entry) =>
        sum + Math.max(0, (input.files.get(entry.relPath)?.rawTokens ?? 0) - entry.tokens),
      0,
    );

  return {
    text,
    entries,
    omitted,
    baselineTokens,
    deliveredTokens,
    reusedTokens,
    signatureSavedTokens,
    budgetTokens: budget,
  };
}
