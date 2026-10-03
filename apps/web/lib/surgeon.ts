import type { Domain, SurgeonFile } from "@onyx/contracts";
import {
  centralityThreshold,
  contentsPattern,
  ContextPolicy,
  isDirectoryPattern,
  normalizePattern,
  renderIgnoreFile,
  type PolicyRule,
} from "@onyx/ignore-compiler/browser";

export type { PolicyRule };

export interface PolicyLayers {
  inherited: readonly PolicyRule[];
  security: readonly PolicyRule[];
}

export interface EditScope extends PolicyLayers {
  paths: readonly string[];
}

export interface EditResult {
  rules: PolicyRule[];
  exact: boolean;
}

const GLOB_CHARS = /[*?[\]]/;
const MAX_REWRITES = 8;

export function composePolicy(
  layers: PolicyLayers,
  editable: readonly PolicyRule[],
): ContextPolicy {
  return ContextPolicy.compose(layers.inherited, editable, layers.security);
}

export function sameRuleSet(a: readonly PolicyRule[], b: readonly PolicyRule[]): boolean {
  return renderIgnoreFile(a) === renderIgnoreFile(b);
}

export function manualRule(
  pattern: string,
  action: PolicyRule["action"],
  reason: string | null = null,
): PolicyRule {
  return { pattern, action, source: "MANUAL", locked: false, reason };
}

export function parseRuleInput(raw: string): PolicyRule | null {
  const trimmed = raw.trim();
  const negated = trimmed.startsWith("!");
  const pattern = normalizePattern(negated ? trimmed.slice(1) : trimmed);
  if (pattern === null) return null;
  return manualRule(pattern, negated ? "INCLUDE" : "EXCLUDE");
}

export function ruleLabel(rule: PolicyRule): string {
  return rule.action === "INCLUDE" ? `!${rule.pattern}` : rule.pattern;
}

export function ancestorsOf(path: string): string[] {
  const segments = path.split("/");
  return segments.slice(0, -1).map((_, index) => segments.slice(0, index + 1).join("/"));
}

export function isUnder(path: string, directory: string): boolean {
  return directory === "" || path.startsWith(`${directory}/`);
}

function anchoredPrefix(pattern: string): string | null {
  const core = pattern.replace(/\/+$/, "");
  if (!pattern.startsWith("/") && !core.includes("/")) return null;
  const literal: string[] = [];
  for (const segment of core.replace(/^\/+/, "").split("/")) {
    if (GLOB_CHARS.test(segment)) break;
    literal.push(segment);
  }
  return literal.join("/");
}

export function ruleWithin(rule: PolicyRule, directory: string): boolean {
  const prefix = anchoredPrefix(rule.pattern);
  return (
    prefix !== null && prefix.length > 0 && (prefix === directory || isUnder(prefix, directory))
  );
}

export function targetsExactly(rule: PolicyRule, path: string): boolean {
  if (rule.pattern.endsWith("/") || GLOB_CHARS.test(rule.pattern)) return false;
  return anchoredPrefix(rule.pattern) === path;
}

function regionOf(paths: readonly string[], target: string): string[] {
  const top = target.split("/")[0] ?? target;
  return paths.filter((path) => path === top || isUnder(path, top));
}

function excludedSet(policy: ContextPolicy, paths: readonly string[]): Set<string> {
  return new Set(paths.filter((path) => policy.isExcluded(path)));
}

function sameSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const value of a) if (!b.has(value)) return false;
  return true;
}

function targetsOf(region: readonly string[], target: string, directory: boolean): string[] {
  return directory ? region.filter((path) => isUnder(path, target)) : [target];
}

export function includeTarget(
  scope: EditScope,
  editable: readonly PolicyRule[],
  target: string,
  directory: boolean,
): EditResult {
  const region = regionOf(scope.paths, target);
  const targets = targetsOf(region.length > 0 ? region : [target], target, directory);
  const locked = new ContextPolicy(scope.security);
  const wanted = excludedSet(composePolicy(scope, editable), region);
  for (const path of targets) if (!locked.isExcluded(path)) wanted.delete(path);
  const satisfied = (rules: readonly PolicyRule[]) =>
    sameSet(excludedSet(composePolicy(scope, rules), region), wanted);

  let rules = editable.filter(
    (rule) =>
      !(
        rule.action === "EXCLUDE" &&
        (directory ? ruleWithin(rule, target) : targetsExactly(rule, target))
      ),
  );
  if (satisfied(rules)) return { rules, exact: true };

  for (let step = 0; step < MAX_REWRITES; step += 1) {
    const policy = composePolicy(scope, rules);
    const probe = targets.find((path) => !wanted.has(path) && policy.isExcluded(path));
    const blocking = probe === undefined ? null : policy.explain(probe).rule;
    if (blocking === null || !rules.includes(blocking) || !isDirectoryPattern(blocking.pattern))
      break;
    rules = rules.map((rule) =>
      rule === blocking ? { ...rule, pattern: contentsPattern(rule.pattern) } : rule,
    );
  }

  const finals = directory
    ? [manualRule(`/${target}/`, "INCLUDE"), manualRule(`/${target}/**`, "INCLUDE")]
    : [manualRule(`/${target}`, "INCLUDE")];
  const groups: PolicyRule[][] = [];
  const assemble = (selected: readonly PolicyRule[][], tail: readonly PolicyRule[]) => [
    ...rules,
    ...selected.flat(),
    ...tail,
  ];

  if (!satisfied(assemble(groups, finals))) {
    for (const ancestor of ancestorsOf(target)) {
      if (!composePolicy(scope, assemble(groups, finals)).isExcluded(ancestor, true)) continue;
      const group = [manualRule(`/${ancestor}/`, "INCLUDE")];
      const opened = excludedSet(composePolicy(scope, assemble([...groups, group], [])), region);
      const leaked = [...wanted].some((path) => !opened.has(path));
      if (leaked) group.push(manualRule(`/${ancestor}/**`, "EXCLUDE"));
      groups.push(group);
      if (satisfied(assemble(groups, finals))) break;
    }
  }

  let kept = groups;
  for (const group of groups) {
    const without = kept.filter((candidate) => candidate !== group);
    if (satisfied(assemble(without, finals))) kept = without;
  }
  let tail = finals;
  if (directory) {
    const contentsOnly = finals.slice(1);
    if (satisfied(assemble(kept, contentsOnly))) tail = contentsOnly;
  }
  const result = assemble(kept, tail);
  return { rules: result, exact: satisfied(result) };
}

export function excludeTarget(
  scope: EditScope,
  editable: readonly PolicyRule[],
  target: string,
  directory: boolean,
): EditResult {
  const region = regionOf(scope.paths, target);
  const targets = targetsOf(region.length > 0 ? region : [target], target, directory);
  const wanted = excludedSet(composePolicy(scope, editable), region);
  for (const path of targets) wanted.add(path);
  const satisfied = (rules: readonly PolicyRule[]) =>
    sameSet(excludedSet(composePolicy(scope, rules), region), wanted);

  const cleared = editable.filter(
    (rule) =>
      !(
        rule.action === "INCLUDE" &&
        (directory ? ruleWithin(rule, target) : targetsExactly(rule, target))
      ),
  );
  if (satisfied(cleared)) return { rules: cleared, exact: true };
  const rules = directory
    ? [...cleared.filter((rule) => !ruleWithin(rule, target)), manualRule(`/${target}/`, "EXCLUDE")]
    : [...cleared, manualRule(`/${target}`, "EXCLUDE")];
  return { rules, exact: satisfied(rules) };
}

export interface RuleImpact {
  files: number;
  tokens: number;
}

export interface Evaluation {
  excluded: Map<string, PolicyRule | null>;
  locked: Set<string>;
  excludedTokens: number;
  totalTokens: number;
  byRule: Map<PolicyRule, RuleImpact>;
}

export function evaluatePolicy(
  policy: ContextPolicy,
  files: readonly SurgeonFile[],
  security: readonly PolicyRule[],
): Evaluation {
  const locked = new ContextPolicy(security);
  const excluded = new Map<string, PolicyRule | null>();
  const lockedPaths = new Set<string>();
  const byRule = new Map<PolicyRule, RuleImpact>();
  let excludedTokens = 0;
  let totalTokens = 0;
  for (const file of files) {
    totalTokens += file.rawTokens;
    const explanation = policy.explain(file.path);
    if (!explanation.excluded) continue;
    excluded.set(file.path, explanation.rule);
    excludedTokens += file.rawTokens;
    if (locked.isExcluded(file.path)) lockedPaths.add(file.path);
    if (explanation.rule) {
      const impact = byRule.get(explanation.rule) ?? { files: 0, tokens: 0 };
      impact.files += 1;
      impact.tokens += file.rawTokens;
      byRule.set(explanation.rule, impact);
    }
  }
  return { excluded, locked: lockedPaths, excludedTokens, totalTokens, byRule };
}

export interface PolicyDiff {
  newlyExcluded: SurgeonFile[];
  newlyIncluded: SurgeonFile[];
  tokenDelta: number;
}

export function diffEvaluations(
  files: readonly SurgeonFile[],
  saved: Evaluation,
  draft: Evaluation,
): PolicyDiff {
  const newlyExcluded: SurgeonFile[] = [];
  const newlyIncluded: SurgeonFile[] = [];
  for (const file of files) {
    const before = saved.excluded.has(file.path);
    const after = draft.excluded.has(file.path);
    if (!before && after) newlyExcluded.push(file);
    else if (before && !after) newlyIncluded.push(file);
  }
  const sum = (items: SurgeonFile[]) => items.reduce((total, file) => total + file.rawTokens, 0);
  return { newlyExcluded, newlyIncluded, tokenDelta: sum(newlyExcluded) - sum(newlyIncluded) };
}

export interface CentralWarning {
  file: SurgeonFile;
  isNew: boolean;
}

export function centralWarnings(
  files: readonly SurgeonFile[],
  saved: Evaluation,
  draft: Evaluation,
): CentralWarning[] {
  const threshold = centralityThreshold(
    files.map((file) => ({
      relPath: file.path,
      sizeBytes: file.sizeBytes,
      rawTokens: file.rawTokens,
      binary: file.binary,
      centrality: file.centrality,
    })),
  );
  return files
    .filter(
      (file) =>
        !file.binary &&
        file.centrality >= threshold &&
        draft.excluded.has(file.path) &&
        !draft.locked.has(file.path),
    )
    .sort((a, b) => b.centrality - a.centrality)
    .map((file) => ({ file, isNew: !saved.excluded.has(file.path) }));
}

export function usdFor(tokens: number, inputUsdPerMTok: number | null | undefined): number | null {
  if (inputUsdPerMTok === null || inputUsdPerMTok === undefined) return null;
  return (tokens * inputUsdPerMTok) / 1_000_000;
}

export interface TreeNode {
  path: string;
  name: string;
  directory: boolean;
  children: TreeNode[];
  file: SurgeonFile | null;
}

export function buildTree(files: readonly SurgeonFile[]): TreeNode {
  const root: TreeNode = { path: "", name: "", directory: true, children: [], file: null };
  const directories = new Map<string, TreeNode>([["", root]]);
  for (const file of files) {
    let parent = root;
    for (const ancestor of ancestorsOf(file.path)) {
      let node = directories.get(ancestor);
      if (!node) {
        node = {
          path: ancestor,
          name: ancestor.slice(ancestor.lastIndexOf("/") + 1),
          directory: true,
          children: [],
          file: null,
        };
        directories.set(ancestor, node);
        parent.children.push(node);
      }
      parent = node;
    }
    parent.children.push({
      path: file.path,
      name: file.path.slice(file.path.lastIndexOf("/") + 1),
      directory: false,
      children: [],
      file,
    });
  }
  return root;
}

export interface DirectoryStats {
  files: number;
  tokens: number;
  excludedFiles: number;
  excludedTokens: number;
  lockedFiles: number;
  changed: number;
}

export function directoryStats(
  files: readonly SurgeonFile[],
  draft: Evaluation,
  saved: Evaluation,
): Map<string, DirectoryStats> {
  const stats = new Map<string, DirectoryStats>();
  for (const file of files) {
    const excluded = draft.excluded.has(file.path);
    const changed = excluded !== saved.excluded.has(file.path);
    for (const directory of ["", ...ancestorsOf(file.path)]) {
      const entry = stats.get(directory) ?? {
        files: 0,
        tokens: 0,
        excludedFiles: 0,
        excludedTokens: 0,
        lockedFiles: 0,
        changed: 0,
      };
      entry.files += 1;
      entry.tokens += file.rawTokens;
      if (excluded) {
        entry.excludedFiles += 1;
        entry.excludedTokens += file.rawTokens;
      }
      if (draft.locked.has(file.path)) entry.lockedFiles += 1;
      if (changed) entry.changed += 1;
      stats.set(directory, entry);
    }
  }
  return stats;
}

export type SelectionState = "included" | "excluded" | "partial" | "locked";

export function directoryState(stats: DirectoryStats | undefined): SelectionState {
  if (!stats) return "included";
  const editable = stats.files - stats.lockedFiles;
  if (editable === 0) return "locked";
  const editableExcluded = stats.excludedFiles - stats.lockedFiles;
  if (editableExcluded === 0) return "included";
  if (editableExcluded === editable) return "excluded";
  return "partial";
}

export type TreeSort = "name" | "tokens";

export interface TreeRow {
  node: TreeNode;
  depth: number;
}

export function flattenTree(
  root: TreeNode,
  expanded: ReadonlySet<string>,
  sort: TreeSort,
  stats: ReadonlyMap<string, DirectoryStats>,
  expandAll = false,
): TreeRow[] {
  const tokensOf = (node: TreeNode) =>
    node.directory ? (stats.get(node.path)?.tokens ?? 0) : (node.file?.rawTokens ?? 0);
  const compare = (a: TreeNode, b: TreeNode) => {
    if (a.directory !== b.directory) return a.directory ? -1 : 1;
    if (sort === "tokens") {
      const delta = tokensOf(b) - tokensOf(a);
      if (delta !== 0) return delta;
    }
    return a.name.localeCompare(b.name);
  };
  const rows: TreeRow[] = [];
  const visit = (node: TreeNode, depth: number) => {
    for (const child of [...node.children].sort(compare)) {
      rows.push({ node: child, depth });
      if (child.directory && (expandAll || expanded.has(child.path))) visit(child, depth + 1);
    }
  };
  visit(root, 0);
  return rows;
}

export function extensionOf(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? "" : name.slice(dot + 1).toLowerCase();
}

export type DomainFilter = Domain | "SHARED" | "all";
export type StateFilter = "all" | "included" | "excluded" | "changed";

export interface TreeFilter {
  search: string;
  domain: DomainFilter;
  extension: string;
  state: StateFilter;
}

export const EMPTY_FILTER: TreeFilter = {
  search: "",
  domain: "all",
  extension: "all",
  state: "all",
};

export function isFiltering(filter: TreeFilter): boolean {
  return (
    filter.search.trim().length > 0 ||
    filter.domain !== "all" ||
    filter.extension !== "all" ||
    filter.state !== "all"
  );
}

export function filterFiles(
  files: readonly SurgeonFile[],
  filter: TreeFilter,
  draft: Evaluation,
  saved: Evaluation,
): SurgeonFile[] {
  const needle = filter.search.trim().toLowerCase();
  return files.filter((file) => {
    if (needle.length > 0 && !file.path.toLowerCase().includes(needle)) return false;
    if (
      filter.domain === "SHARED"
        ? file.domain !== null
        : filter.domain !== "all" && file.domain !== filter.domain
    )
      return false;
    if (filter.extension !== "all" && extensionOf(file.path) !== filter.extension) return false;
    const excluded = draft.excluded.has(file.path);
    if (filter.state === "included" && excluded) return false;
    if (filter.state === "excluded" && !excluded) return false;
    if (filter.state === "changed" && excluded === saved.excluded.has(file.path)) return false;
    return true;
  });
}

export function heatOf(tokens: number, total: number): number {
  if (tokens <= 0 || total <= 1) return 0;
  return Math.min(1, Math.log1p(tokens) / Math.log1p(total));
}

export function heatColor(heat: number): string {
  const hue = Math.round(230 - 205 * heat);
  return `oklch(0.72 0.16 ${hue})`;
}
