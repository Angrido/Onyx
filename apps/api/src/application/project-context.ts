import { readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";
import type {
  DepsInput,
  ExpandSymbolInput,
  FileContextDto,
  FileSkeletonInput,
  GraphResponse,
  McpToolResult,
  SearchSymbolsInput,
  SymbolDto,
} from "@onyx/contracts";
import {
  buildContextPack,
  contentHash,
  dependencyCycles,
  effectiveDependencies,
  expandTargetPaths,
  heuristicDomain,
  inferTargets,
  neighborhood,
  proposeDomainGlobs,
  type ContextPack,
  type PackFile,
} from "@onyx/graphify";
import {
  describeEntry,
  formatTokenCount,
  renderProjectMap,
  renderSymbolSource,
  type ContextLevel,
  type FileAnalysis,
  type LeanAnalyzer,
  type LeanSymbol,
  type ProjectMap,
} from "@onyx/lean-ctx";
import { EMPTY_POLICY, type ContextPolicy } from "@onyx/ignore-compiler";
import type { StoredFile, StoredIndex } from "../infrastructure/index-store";

const MAX_SOURCE_BYTES = 2 * 1024 * 1024;
const MAX_EXTERNAL_MODULES = 30;
const SENSITIVE_NOTICE =
  "This file was flagged by the secret scanner during indexing. Onyx does not send its content; open it only if the task really requires it.";

export interface PackRequest {
  targetPaths: readonly string[];
  prompt: string;
  budgetTokens: number;
  policy?: ContextPolicy;
  delivered?: ReadonlyMap<string, string>;
}

export interface PackResult {
  pack: ContextPack | null;
  targets: string[];
  inferredTargets: string[];
  excludedTargets: string[];
}

const EXCLUDED_NOTICE =
  "This file is outside the agent's context: the project's Onyx context profile excludes it.";

export interface GraphRequest {
  focus: string | null;
  depth: number;
  limit: number;
}

interface CurrentFile {
  content: string;
  analysis: FileAnalysis | null;
  changed: boolean;
}

interface HandleEntry {
  file: StoredFile;
  symbol: LeanSymbol;
}

function result(text: string, tokens: number, isError = false): McpToolResult {
  return { text, tokens, isError };
}

function toSymbolDto(symbol: LeanSymbol): SymbolDto {
  return {
    handle: symbol.handle,
    name: symbol.name,
    qualifiedName: symbol.qualifiedName,
    kind: symbol.kind,
    signature: symbol.signature,
    startLine: symbol.startLine,
    endLine: symbol.endLine,
    bodyTokens: symbol.bodyTokens,
    exported: symbol.exported,
  };
}

export class ProjectContext {
  readonly rank: Map<string, number>;
  private readonly handles = new Map<string, HandleEntry[]>();
  private readonly exportOwners = new Map<string, string[]>();
  private readonly currentCache = new Map<string, CurrentFile & { hash: string }>();
  private readonly realRoot: string;
  private packFileCache: Map<string, PackFile> | null = null;
  private cycleCache: string[][] | null = null;

  constructor(
    readonly projectId: string,
    readonly rootDir: string,
    readonly index: StoredIndex,
    private readonly analyzer: LeanAnalyzer,
  ) {
    this.realRoot = realpathSync(rootDir);
    this.rank = new Map([...index.files].map(([path, file]) => [path, file.centrality]));
    for (const file of index.files.values()) {
      for (const symbol of file.analysis?.symbols ?? []) {
        const entries = this.handles.get(symbol.handle) ?? [];
        entries.push({ file, symbol });
        this.handles.set(symbol.handle, entries);
        if (symbol.exported && !symbol.qualifiedName.includes(".")) {
          const owners = this.exportOwners.get(symbol.name) ?? [];
          if (!owners.includes(file.relPath)) owners.push(file.relPath);
          this.exportOwners.set(symbol.name, owners);
        }
      }
    }
  }

  get indexedAt(): Date | null {
    return this.index.indexedAt;
  }

  get fileCount(): number {
    return this.index.files.size;
  }

  normalizePath(path: string): string | null {
    const trimmed = path.trim();
    if (trimmed.length === 0) return null;
    let candidate = trimmed;
    if (isAbsolute(trimmed)) {
      for (const root of [this.rootDir, this.realRoot]) {
        const inside = relative(root, trimmed);
        if (!inside.startsWith("..") && !isAbsolute(inside)) {
          candidate = inside;
          break;
        }
      }
      if (isAbsolute(candidate)) return null;
    }
    const normalized = candidate.split(sep).join("/").replace(/^\.\//, "").replace(/\/+$/, "");
    return normalized.length === 0 ? null : normalized;
  }

  readSource(relPath: string): string | null {
    if (!this.index.files.has(relPath)) return null;
    try {
      const absolute = realpathSync(join(this.rootDir, relPath));
      if (absolute !== this.realRoot && !absolute.startsWith(`${this.realRoot}${sep}`)) return null;
      if (statSync(absolute).size > MAX_SOURCE_BYTES) return null;
      return readFileSync(absolute, "utf8");
    } catch {
      return null;
    }
  }

  current(relPath: string): CurrentFile | null {
    const stored = this.index.files.get(relPath);
    const content = this.readSource(relPath);
    if (!stored || content === null) return null;
    const hash = contentHash(content);
    if (hash === stored.contentHash) return { content, analysis: stored.analysis, changed: false };
    const cached = this.currentCache.get(relPath);
    if (cached?.hash === hash) return cached;
    const fresh = {
      content,
      analysis: this.analyzer.analyze(relPath, content),
      changed: true,
      hash,
    };
    this.currentCache.set(relPath, fresh);
    return fresh;
  }

  packFiles(): Map<string, PackFile> {
    if (this.packFileCache) return this.packFileCache;
    this.packFileCache = new Map(
      [...this.index.files].map(([relPath, file]) => [
        relPath,
        {
          relPath,
          language: file.language,
          rawTokens: file.rawTokens,
          l1Tokens: file.analysis?.l1Tokens ?? null,
          l2Tokens: file.analysis?.l2Tokens ?? null,
          skeletonL1: file.analysis?.skeletonL1 ?? null,
          skeletonL2: file.analysis?.skeletonL2 ?? null,
          exports: file.analysis?.exports ?? [],
          typeNames: (file.analysis?.symbols ?? [])
            .filter(
              (symbol) =>
                symbol.exported &&
                !symbol.qualifiedName.includes(".") &&
                (symbol.kind === "interface" || symbol.kind === "type" || symbol.kind === "enum"),
            )
            .map((symbol) => symbol.name),
          sensitive: file.sensitive,
        },
      ]),
    );
    return this.packFileCache;
  }

  resolveTargets(
    targetPaths: readonly string[],
    prompt: string,
    policy: ContextPolicy = EMPTY_POLICY,
  ): { explicit: string[]; inferred: string[] } {
    const files = [...this.index.files.keys()].filter((path) => !policy.isExcluded(path));
    const explicit = expandTargetPaths(
      targetPaths
        .map((path) => this.normalizePath(path))
        .filter((path): path is string => path !== null),
      files,
      this.rank,
    );
    const inferred = inferTargets({ prompt, files, symbolFiles: this.exportOwners }).filter(
      (path) => !explicit.includes(path),
    );
    return { explicit, inferred };
  }

  fileFacts(relPath: string): { blastRadius: number | null; rawTokens: number } | null {
    const file = this.index.files.get(relPath);
    return file ? { blastRadius: file.blastRadius, rawTokens: file.rawTokens } : null;
  }

  buildPack(request: PackRequest): PackResult {
    const policy = request.policy ?? EMPTY_POLICY;
    const files = [...this.index.files.keys()].filter((path) => !policy.isExcluded(path));
    const requested = expandTargetPaths(
      request.targetPaths
        .map((path) => this.normalizePath(path))
        .filter((path): path is string => path !== null),
      [...this.index.files.keys()],
      this.rank,
    );
    const excludedTargets = requested.filter((path) => policy.isExcluded(path));
    const explicit = expandTargetPaths(
      request.targetPaths
        .map((path) => this.normalizePath(path))
        .filter((path): path is string => path !== null),
      files,
      this.rank,
    );
    const inferred = inferTargets({
      prompt: request.prompt,
      files,
      symbolFiles: this.exportOwners,
    }).filter((path) => !explicit.includes(path));
    const targets = [...explicit, ...inferred];
    const allowed = new Map(
      [...this.packFiles()].filter(
        ([path]) => !policy.isExcluded(path) && !this.index.files.get(path)?.binary,
      ),
    );
    const pack = buildContextPack({
      targets,
      graph: this.index.graph,
      files: allowed,
      readSource: (relPath) => this.readSource(relPath),
      rank: this.rank,
      estimator: this.analyzer.estimator,
      budgetTokens: request.budgetTokens,
      ...(request.delivered ? { delivered: request.delivered } : {}),
      excerpt: (relPath, level, names) => {
        const content = this.readSource(relPath);
        return content === null ? null : this.analyzer.excerpt(relPath, content, level, names);
      },
    });
    return { pack, targets, inferredTargets: inferred, excludedTargets };
  }

  projectMap(budgetTokens: number, policy: ContextPolicy = EMPTY_POLICY): ProjectMap {
    return renderProjectMap(
      [...this.index.files.values()]
        .filter((file) => !file.binary && !policy.isExcluded(file.relPath))
        .map((file) => ({
          relPath: file.relPath,
          tokens: file.rawTokens,
          exports: file.analysis?.exports ?? [],
          rank: file.centrality,
        })),
      { budgetTokens, estimator: this.analyzer.estimator },
    );
  }

  fileContext(path: string, level: ContextLevel): FileContextDto | null {
    const relPath = this.normalizePath(path);
    const stored = relPath === null ? undefined : this.index.files.get(relPath);
    if (!relPath || !stored) return null;
    const current = this.current(relPath);
    const analysis = current?.analysis ?? stored.analysis;
    let content: string;
    if (stored.sensitive && level > 0) content = SENSITIVE_NOTICE;
    else if (level === 3) content = current?.content ?? "";
    else if (level === 2) content = analysis?.skeletonL2 ?? current?.content ?? "";
    else if (level === 1) content = analysis?.skeletonL1 ?? current?.content ?? "";
    else
      content = describeEntry({
        relPath,
        tokens: stored.rawTokens,
        exports: analysis?.exports ?? [],
      });
    return {
      relPath,
      language: stored.language,
      level,
      content,
      tokens: this.analyzer.estimator.estimate(content, stored.language),
      rawTokens: stored.rawTokens,
      l1Tokens: analysis?.l1Tokens ?? null,
      l2Tokens: analysis?.l2Tokens ?? null,
      sensitive: stored.sensitive,
      domain: stored.domain,
      centrality: stored.centrality,
      blastRadius: stored.blastRadius,
      dependencies: this.index.graph.dependencies(relPath).sort(),
      dependents: this.index.graph.dependents(relPath).sort(),
      externalImports: [
        ...new Set(
          this.index.graph
            .edgesFrom(relPath)
            .map((edge) => edge.external)
            .filter((name): name is string => name !== null),
        ),
      ].sort(),
      symbols: (analysis?.symbols ?? []).map(toSymbolDto),
    };
  }

  graph(request: GraphRequest): GraphResponse {
    const files = this.index.files;
    const focus = request.focus === null ? null : this.normalizePath(request.focus);
    const distances =
      focus !== null && files.has(focus)
        ? neighborhood(this.index.graph, [focus], request.depth, "both")
        : null;
    let selected = distances ? [...distances.keys()] : [...files.keys()];
    const totalNodes = selected.length;
    if (selected.length > request.limit) {
      selected = selected
        .sort((a, b) => (this.rank.get(b) ?? 0) - (this.rank.get(a) ?? 0))
        .slice(0, request.limit);
      if (focus !== null && distances && !selected.includes(focus)) selected.push(focus);
    }
    const included = new Set(selected);
    const seenEdges = new Set<string>();
    const edges: GraphResponse["edges"] = [];
    const importers = new Map<string, Set<string>>();
    for (const edge of this.index.graph.edges) {
      if (edge.external !== null) {
        const set = importers.get(edge.external) ?? new Set<string>();
        set.add(edge.from);
        importers.set(edge.external, set);
      }
      if (edge.to === null || edge.to === edge.from) continue;
      if (!included.has(edge.from) || !included.has(edge.to)) continue;
      const key = `${edge.from}\u0000${edge.to}`;
      if (seenEdges.has(key)) continue;
      seenEdges.add(key);
      edges.push({ from: edge.from, to: edge.to, kind: edge.kind });
    }
    return {
      projectId: this.projectId,
      indexedAt: this.index.indexedAt?.toISOString() ?? null,
      focus: focus !== null && files.has(focus) ? focus : null,
      depth: request.depth,
      totalNodes,
      truncated: totalNodes > selected.length,
      nodes: selected.flatMap((relPath) => {
        const file = files.get(relPath);
        if (!file) return [];
        return [
          {
            id: relPath,
            language: file.language,
            rawTokens: file.rawTokens,
            l1Tokens: file.analysis?.l1Tokens ?? null,
            symbols: file.analysis?.symbols.length ?? 0,
            inDegree: file.inDegree,
            outDegree: file.outDegree,
            centrality: file.centrality,
            blastRadius: file.blastRadius,
            domain: file.domain,
            inCycle: file.inCycle,
            sensitive: file.sensitive,
            distance: distances?.get(relPath) ?? null,
          },
        ];
      }),
      edges,
      cycles: this.cycles().filter((cycle) => cycle.some((member) => included.has(member))),
      externalModules: [...importers]
        .map(([name, set]) => ({ name, importers: set.size }))
        .sort((a, b) => b.importers - a.importers || a.name.localeCompare(b.name))
        .slice(0, MAX_EXTERNAL_MODULES),
      proposedWorkspaceGlobs: proposeDomainGlobs(
        [...files.keys()].map((relPath) => ({ relPath, domain: heuristicDomain(relPath) })),
      ),
    };
  }

  expandSymbol(input: ExpandSymbolInput, policy: ContextPolicy = EMPTY_POLICY): McpToolResult {
    const located = this.locateSymbol(input);
    if (typeof located === "string") return result(located, 0, true);
    const { relPath, symbol, current, alternatives } = located;
    if (policy.isExcluded(relPath)) return result(EXCLUDED_NOTICE, 0, true);
    if (this.index.files.get(relPath)?.sensitive) return result(SENSITIVE_NOTICE, 0, true);
    const rendered = renderSymbolSource(current.content, symbol.startLine, symbol.endLine);
    const lines = [
      `${relPath}:${symbol.startLine}-${symbol.endLine} · ${symbol.kind} ${symbol.qualifiedName} (#${symbol.handle})`,
      rendered.text,
    ];
    if (rendered.truncated) {
      lines.push(`… truncated; read ${relPath} from line ${symbol.startLine + 400} for the rest.`);
    }
    if (alternatives.length > 0) {
      lines.push(`Other symbols share this handle: ${alternatives.join(", ")}`);
    }
    const text = lines.join("\n");
    return result(text, this.analyzer.estimator.estimate(text, current.analysis?.language ?? null));
  }

  fileSkeleton(input: FileSkeletonInput, policy: ContextPolicy = EMPTY_POLICY): McpToolResult {
    const relPath = this.normalizePath(input.path);
    const stored = relPath === null ? undefined : this.index.files.get(relPath);
    if (!relPath || !stored) return result(`Unknown file: ${input.path}`, 0, true);
    if (policy.isExcluded(relPath)) return result(EXCLUDED_NOTICE, 0, true);
    const level = input.level ?? 1;
    const current = this.current(relPath);
    const analysis = current?.analysis ?? stored.analysis;
    let body: string;
    if (level === 0 || stored.sensitive || analysis === null) {
      const symbols = (analysis?.symbols ?? []).map(
        (symbol) =>
          `  #${symbol.handle} ${symbol.kind} ${symbol.qualifiedName} :: ${symbol.signature}`,
      );
      body = [
        describeEntry({ relPath, tokens: stored.rawTokens, exports: analysis?.exports ?? [] }),
        ...(stored.sensitive ? [SENSITIVE_NOTICE] : symbols),
      ].join("\n");
    } else {
      body = level === 2 ? analysis.skeletonL2 : analysis.skeletonL1;
    }
    const label = level === 2 ? "contracts" : level === 1 ? "signatures" : "map";
    const text = [
      `${relPath} · ${label} · full file ~${formatTokenCount(stored.rawTokens)} tokens${current?.changed ? " · re-parsed (changed since indexing)" : ""}`,
      body,
    ].join("\n");
    return result(text, this.analyzer.estimator.estimate(text, stored.language));
  }

  deps(input: DepsInput, policy: ContextPolicy = EMPTY_POLICY): McpToolResult {
    const relPath = this.normalizePath(input.path);
    if (!relPath || !this.index.files.has(relPath))
      return result(`Unknown file: ${input.path}`, 0, true);
    if (policy.isExcluded(relPath)) return result(EXCLUDED_NOTICE, 0, true);
    const direction = input.direction ?? "both";
    const depth = input.depth ?? 1;
    const lines: string[] = [relPath];
    const describe = (path: string) => {
      const file = this.index.files.get(path);
      return describeEntry({
        relPath: path,
        tokens: file?.rawTokens ?? 0,
        exports: file?.analysis?.exports ?? [],
      });
    };
    const section = (title: string, sectionDirection: "in" | "out") => {
      const distances = neighborhood(this.index.graph, [relPath], depth, sectionDirection);
      distances.delete(relPath);
      if (sectionDirection === "out") {
        for (const dependency of effectiveDependencies(
          this.index.graph,
          (path) => this.index.files.get(path)?.analysis?.exports,
          relPath,
        )) {
          distances.set(dependency.relPath, 1);
        }
      }
      const entries = [...distances]
        .filter(([path]) => !policy.isExcluded(path))
        .sort((a, b) => a[1] - b[1] || (this.rank.get(b[0]) ?? 0) - (this.rank.get(a[0]) ?? 0));
      lines.push(`${title} (${entries.length}):`);
      for (const [path, distance] of entries) {
        const directory = path.slice(0, path.lastIndexOf("/") + 1);
        lines.push(`  ${distance}  ${directory}${describe(path)}`);
      }
    };
    if (direction !== "in") section("imports", "out");
    if (direction !== "out") section("imported by", "in");
    if (direction !== "in") {
      const externals = [
        ...new Set(
          this.index.graph
            .edgesFrom(relPath)
            .map((edge) => edge.external)
            .filter((name): name is string => name !== null),
        ),
      ];
      if (externals.length > 0) lines.push(`external: ${externals.sort().join(", ")}`);
    }
    lines.push("Use file_skeleton for contracts and expand_symbol for bodies.");
    const text = lines.join("\n");
    return result(text, this.analyzer.estimator.estimate(text, "text"));
  }

  searchSymbols(input: SearchSymbolsInput, policy: ContextPolicy = EMPTY_POLICY): McpToolResult {
    const query = input.query.trim().toLowerCase();
    const limit = input.limit ?? 20;
    const scored: { score: number; entry: HandleEntry }[] = [];
    for (const entries of this.handles.values()) {
      for (const entry of entries) {
        if (input.kind && entry.symbol.kind !== input.kind) continue;
        if (policy.isExcluded(entry.file.relPath)) continue;
        const name = entry.symbol.name.toLowerCase();
        const qualified = entry.symbol.qualifiedName.toLowerCase();
        let score: number;
        if (name === query || qualified === query) score = 3;
        else if (name.startsWith(query)) score = 2;
        else if (qualified.includes(query)) score = 1;
        else continue;
        score += entry.symbol.exported ? 0.5 : 0;
        score += Math.min(0.4, entry.file.centrality * 10);
        scored.push({ score, entry });
      }
    }
    scored.sort(
      (a, b) => b.score - a.score || a.entry.symbol.name.localeCompare(b.entry.symbol.name),
    );
    const lines = scored.slice(0, limit).map(({ entry }) => {
      const { symbol, file } = entry;
      return `#${symbol.handle} ${symbol.kind} ${symbol.qualifiedName} — ${file.relPath}:${symbol.startLine} — ${symbol.signature}`;
    });
    const text =
      lines.length === 0
        ? `No symbols match "${input.query}".`
        : [`${scored.length} match(es), showing ${lines.length}:`, ...lines].join("\n");
    return result(text, this.analyzer.estimator.estimate(text, "text"));
  }

  cycles(): string[][] {
    this.cycleCache ??= dependencyCycles(this.index.graph);
    return this.cycleCache;
  }

  private locateSymbol(
    input: ExpandSymbolInput,
  ):
    string | { relPath: string; symbol: LeanSymbol; current: CurrentFile; alternatives: string[] } {
    let relPath: string | null = null;
    let qualifiedName: string | null = null;
    let alternatives: string[] = [];
    if (input.handle !== undefined) {
      const handle = input.handle.replace(/^#/, "");
      const entries = this.handles.get(handle) ?? [];
      const first = entries[0];
      if (!first)
        return `Unknown handle #${handle}. Use search_symbols or file_skeleton to find handles.`;
      relPath = first.file.relPath;
      qualifiedName = first.symbol.qualifiedName;
      alternatives = entries
        .slice(1)
        .map((entry) => `${entry.file.relPath}#${entry.symbol.qualifiedName}`);
    } else if (input.path !== undefined && input.qualifiedName !== undefined) {
      relPath = this.normalizePath(input.path);
      qualifiedName = input.qualifiedName;
    }
    if (relPath === null || qualifiedName === null)
      return "Pass a handle, or a path with a qualifiedName.";
    const current = this.current(relPath);
    if (!current) return `Cannot read ${relPath}.`;
    const symbol = current.analysis?.symbols.find(
      (candidate) => candidate.qualifiedName === qualifiedName,
    );
    if (!symbol) return `Symbol ${qualifiedName} no longer exists in ${relPath}.`;
    return { relPath, symbol, current, alternatives };
  }
}
