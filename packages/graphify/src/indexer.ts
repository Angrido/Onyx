import { createHash } from "node:crypto";
import { setImmediate as yieldToEventLoop } from "node:timers/promises";
import {
  analyzerVersion,
  detectFileKind,
  detectLanguage,
  type FileAnalysis,
  type LanguageId,
  type LeanAnalyzer,
} from "@onyx/lean-ctx";
import { DomainClassifier, type DomainAssignment, type WorkspaceRule } from "./domains";
import {
  enumerateProject,
  type EnumeratedFile,
  type SecurityFinding,
  type SkippedFile,
} from "./enumerate";
import { DependencyGraph, edgeKindOf, type GraphEdge } from "./graph";
import { blastRadii, dependencyCycles, pageRank } from "./metrics";
import { ModuleResolver } from "./resolver";

export interface IndexedFile {
  relPath: string;
  kind: string | null;
  language: LanguageId | null;
  sizeBytes: number;
  contentHash: string;
  rawTokens: number;
  sensitive: boolean;
  analysis: FileAnalysis | null;
  reused: boolean;
}

export interface PreviousFile {
  contentHash: string;
  analyzerVersion: string | null;
  analysis: FileAnalysis | null;
}

export type IndexPhase = "enumerating" | "analyzing" | "linking" | "ranking";

export interface IndexProgress {
  phase: IndexPhase;
  done: number;
  total: number;
}

export interface FileMetrics {
  inDegree: number;
  outDegree: number;
  centrality: number;
  blastRadius: number | null;
  inCycle: boolean;
  domain: DomainAssignment | null;
}

export interface IndexStats {
  files: number;
  parsedFiles: number;
  reusedFiles: number;
  skippedFiles: number;
  syntaxErrorFiles: number;
  symbols: number;
  internalEdges: number;
  externalModules: number;
  rawTokens: number;
  l1Tokens: number;
  cycles: number;
  sensitiveFiles: number;
  durationMs: number;
}

export interface ProjectIndex {
  rootDir: string;
  analyzerVersion: string;
  files: Map<string, IndexedFile>;
  graph: DependencyGraph;
  metrics: Map<string, FileMetrics>;
  cycles: string[][];
  skipped: SkippedFile[];
  findings: SecurityFinding[];
  stats: IndexStats;
}

export interface IndexProjectOptions {
  rootDir: string;
  analyzer: LeanAnalyzer;
  previous?: ReadonlyMap<string, PreviousFile>;
  ignorePatterns?: readonly string[];
  domainRules?: readonly WorkspaceRule[];
  securityCheck?: boolean;
  onProgress?: (progress: IndexProgress) => void;
  signal?: AbortSignal;
}

const MAX_PARSE_BYTES = 512 * 1024;
const MINIFIED_LINE_LENGTH = 400;
const YIELD_INTERVAL_MS = 15;

export function contentHash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

export function looksMinified(content: string): boolean {
  if (content.length < 4_000) return false;
  const lines = content.split("\n").length;
  return content.length / lines > MINIFIED_LINE_LENGTH;
}

class Pacer {
  private last = performance.now();

  constructor(private readonly signal: AbortSignal | undefined) {}

  async tick(): Promise<void> {
    this.signal?.throwIfAborted();
    if (performance.now() - this.last < YIELD_INTERVAL_MS) return;
    await yieldToEventLoop();
    this.last = performance.now();
    this.signal?.throwIfAborted();
  }
}

function analyzeFile(
  file: EnumeratedFile,
  hash: string,
  options: IndexProjectOptions,
  version: string,
  sensitive: boolean,
): IndexedFile {
  const language = detectLanguage(file.relPath);
  const kind = detectFileKind(file.relPath);
  const previous = options.previous?.get(file.relPath);
  const base = {
    relPath: file.relPath,
    kind,
    language,
    sizeBytes: file.sizeBytes,
    contentHash: hash,
    sensitive,
  };
  if (previous && previous.contentHash === hash && previous.analyzerVersion === version) {
    return {
      ...base,
      rawTokens:
        previous.analysis?.rawTokens ?? options.analyzer.estimator.estimate(file.content, kind),
      analysis: previous.analysis,
      reused: true,
    };
  }
  const parseable =
    language !== null && file.sizeBytes <= MAX_PARSE_BYTES && !looksMinified(file.content);
  const analysis = parseable
    ? options.analyzer.analyze(file.relPath, file.content, language)
    : null;
  return {
    ...base,
    rawTokens: analysis?.rawTokens ?? options.analyzer.estimator.estimate(file.content, kind),
    analysis,
    reused: false,
  };
}

function linkFiles(
  files: ReadonlyMap<string, IndexedFile>,
  contents: ReadonlyMap<string, string>,
): GraphEdge[] {
  const resolver = new ModuleResolver(files.keys(), (relPath) => contents.get(relPath) ?? null);
  const edges: GraphEdge[] = [];
  for (const file of files.values()) {
    if (!file.analysis || file.language === null) continue;
    for (const ref of file.analysis.imports) {
      for (const resolution of resolver.resolve(file.relPath, ref, file.language)) {
        if (resolution.kind === "unresolved") continue;
        edges.push({
          from: file.relPath,
          to: resolution.kind === "internal" ? resolution.target : null,
          external: resolution.kind === "external" ? resolution.module : null,
          kind: edgeKindOf(ref),
          specifier: ref.specifier,
          names: ref.names,
        });
      }
    }
  }
  return edges;
}

export function computeMetrics(
  graph: DependencyGraph,
  classifier: DomainClassifier,
): { metrics: Map<string, FileMetrics>; cycles: string[][] } {
  const ranks = pageRank(graph);
  const radii = blastRadii(graph);
  const cycles = dependencyCycles(graph);
  const cyclic = new Set(cycles.flat());
  const metrics = new Map<string, FileMetrics>();
  for (const node of graph.nodes) {
    metrics.set(node, {
      inDegree: graph.inDegree(node),
      outDegree: graph.outDegree(node),
      centrality: ranks.get(node) ?? 0,
      blastRadius: radii?.get(node) ?? null,
      inCycle: cyclic.has(node),
      domain: classifier.classify(node),
    });
  }
  return { metrics, cycles };
}

export async function indexProject(options: IndexProjectOptions): Promise<ProjectIndex> {
  const started = performance.now();
  const pacer = new Pacer(options.signal);
  const version = analyzerVersion();
  options.onProgress?.({ phase: "enumerating", done: 0, total: 0 });

  const enumeration = await enumerateProject(options.rootDir, {
    ...(options.ignorePatterns ? { ignorePatterns: options.ignorePatterns } : {}),
    ...(options.securityCheck === undefined ? {} : { securityCheck: options.securityCheck }),
  });
  const sensitive = new Set(enumeration.findings.map((finding) => finding.relPath));
  const total = enumeration.files.length;
  const files = new Map<string, IndexedFile>();
  const contents = new Map<string, string>();

  for (const [position, file] of enumeration.files.entries()) {
    await pacer.tick();
    const hash = contentHash(file.content);
    files.set(file.relPath, analyzeFile(file, hash, options, version, sensitive.has(file.relPath)));
    contents.set(file.relPath, file.content);
    if (position % 50 === 0 || position === total - 1) {
      options.onProgress?.({ phase: "analyzing", done: position + 1, total });
    }
  }

  options.onProgress?.({ phase: "linking", done: 0, total });
  await pacer.tick();
  const edges = linkFiles(files, contents);
  const graph = new DependencyGraph([...files.keys()], edges);

  options.onProgress?.({ phase: "ranking", done: 0, total });
  await pacer.tick();
  const { metrics, cycles } = computeMetrics(
    graph,
    new DomainClassifier(options.domainRules ?? []),
  );

  const analyses = [...files.values()];
  const stats: IndexStats = {
    files: files.size,
    parsedFiles: analyses.filter((file) => file.analysis !== null && !file.reused).length,
    reusedFiles: analyses.filter((file) => file.reused).length,
    skippedFiles: enumeration.skipped.length,
    syntaxErrorFiles: analyses.filter((file) => file.analysis?.hasSyntaxErrors).length,
    symbols: analyses.reduce((sum, file) => sum + (file.analysis?.symbols.length ?? 0), 0),
    internalEdges: graph.internalEdgeCount(),
    externalModules: new Set(edges.map((edge) => edge.external).filter(Boolean)).size,
    rawTokens: analyses.reduce((sum, file) => sum + file.rawTokens, 0),
    l1Tokens: analyses.reduce((sum, file) => sum + (file.analysis?.l1Tokens ?? file.rawTokens), 0),
    cycles: cycles.length,
    sensitiveFiles: sensitive.size,
    durationMs: Math.round(performance.now() - started),
  };
  options.onProgress?.({ phase: "ranking", done: total, total });

  return {
    rootDir: options.rootDir,
    analyzerVersion: version,
    files,
    graph,
    metrics,
    cycles,
    skipped: enumeration.skipped,
    findings: enumeration.findings,
    stats,
  };
}
