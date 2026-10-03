import type { Domain, IndexStats } from "@onyx/contracts";
import type { CodeSymbol, FileNode, Prisma, PrismaClient } from "@onyx/db";
import {
  DependencyGraph,
  type EdgeKindName,
  type GraphEdge,
  type ProjectIndex,
} from "@onyx/graphify";
import {
  SUPPORTED_LANGUAGES,
  type FileAnalysis,
  type ImportRef,
  type LanguageId,
  type LeanSymbol,
  type SymbolKind,
} from "@onyx/lean-ctx";

export interface StoredFile {
  id: string;
  relPath: string;
  language: string | null;
  contentHash: string;
  analyzerVersion: string | null;
  sizeBytes: number;
  rawTokens: number;
  sensitive: boolean;
  domain: Domain | null;
  inDegree: number;
  outDegree: number;
  centrality: number;
  blastRadius: number | null;
  inCycle: boolean;
  analysis: FileAnalysis | null;
}

export interface StoredIndex {
  projectId: string;
  indexedAt: Date | null;
  stats: IndexStats | null;
  files: Map<string, StoredFile>;
  graph: DependencyGraph;
}

const WRITE_CHUNK = 400;
const TRANSACTION_TIMEOUT_MS = 300_000;

function isLanguageId(value: string | null): value is LanguageId {
  return value !== null && (SUPPORTED_LANGUAGES as readonly string[]).includes(value);
}

function asStringArray(value: Prisma.JsonValue | null): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function asImports(value: Prisma.JsonValue | null): ImportRef[] {
  return Array.isArray(value) ? (value as unknown as ImportRef[]) : [];
}

function toLeanSymbol(symbol: CodeSymbol): LeanSymbol {
  return {
    handle: symbol.handle,
    name: symbol.name,
    qualifiedName: symbol.qualifiedName,
    kind: symbol.kind as SymbolKind,
    signature: symbol.signature,
    startOffset: symbol.startOffset,
    endOffset: symbol.endOffset,
    startLine: symbol.startLine,
    endLine: symbol.endLine,
    bodyTokens: symbol.bodyTokens,
    exported: symbol.exported,
  };
}

function toStoredFile(node: FileNode & { symbols: CodeSymbol[] }): StoredFile {
  const analysis: FileAnalysis | null =
    isLanguageId(node.language) && node.skeletonL1 !== null && node.skeletonL2 !== null
      ? {
          relPath: node.relPath,
          language: node.language,
          hasSyntaxErrors: node.hasSyntaxErrors,
          symbols: node.symbols
            .map(toLeanSymbol)
            .sort((a: LeanSymbol, b: LeanSymbol) => a.startOffset - b.startOffset),
          imports: asImports(node.imports),
          exports: asStringArray(node.exports),
          skeletonL1: node.skeletonL1,
          skeletonL2: node.skeletonL2,
          rawTokens: node.rawTokens,
          l1Tokens: node.l1Tokens ?? node.rawTokens,
          l2Tokens: node.l2Tokens ?? node.rawTokens,
        }
      : null;
  return {
    id: node.id,
    relPath: node.relPath,
    language: node.language,
    contentHash: node.contentHash,
    analyzerVersion: node.analyzerVersion,
    sizeBytes: node.sizeBytes,
    rawTokens: node.rawTokens,
    sensitive: node.isSensitive,
    domain: node.domain,
    inDegree: node.inDegree,
    outDegree: node.outDegree,
    centrality: node.centrality ?? 0,
    blastRadius: node.blastRadius,
    inCycle: node.inCycle,
    analysis,
  };
}

function chunks<T>(items: readonly T[], size = WRITE_CHUNK): T[][] {
  const result: T[][] = [];
  for (let start = 0; start < items.length; start += size)
    result.push(items.slice(start, start + size));
  return result;
}

export class IndexStore {
  constructor(private readonly prisma: PrismaClient) {}

  async load(projectId: string): Promise<StoredIndex | null> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { indexedAt: true, indexStats: true },
    });
    if (!project || project.indexedAt === null) return null;

    const nodes = await this.prisma.fileNode.findMany({
      where: { projectId },
      include: { symbols: true },
    });
    const pathById = new Map(nodes.map((node) => [node.id, node.relPath]));
    const edges = await this.prisma.dependencyEdge.findMany({ where: { projectId } });
    const graphEdges: GraphEdge[] = edges.flatMap((edge) => {
      const from = pathById.get(edge.fromId);
      if (from === undefined) return [];
      return [
        {
          from,
          to: edge.toId === null ? null : (pathById.get(edge.toId) ?? null),
          external: edge.external,
          kind: edge.kind as EdgeKindName,
          specifier: edge.specifier,
          names: asStringArray(edge.symbols),
        },
      ];
    });
    const files = new Map(nodes.map((node) => [node.relPath, toStoredFile(node)]));
    return {
      projectId,
      indexedAt: project.indexedAt,
      stats: (project.indexStats as IndexStats | null) ?? null,
      files,
      graph: new DependencyGraph([...files.keys()], graphEdges),
    };
  }

  async save(projectId: string, index: ProjectIndex, indexedAt = new Date()): Promise<void> {
    await this.prisma.$transaction(
      async (tx) => {
        const existing = await tx.fileNode.findMany({
          where: { projectId },
          select: { id: true, relPath: true, contentHash: true, analyzerVersion: true },
        });
        const existingByPath = new Map(existing.map((node) => [node.relPath, node]));
        const removed = existing
          .filter((node) => !index.files.has(node.relPath))
          .map((node) => node.id);
        for (const ids of chunks(removed))
          await tx.fileNode.deleteMany({ where: { id: { in: ids } } });

        const idByPath = new Map<string, string>();
        for (const file of index.files.values()) {
          const metrics = index.metrics.get(file.relPath);
          const analysis = file.analysis;
          const metricData = {
            inDegree: metrics?.inDegree ?? 0,
            outDegree: metrics?.outDegree ?? 0,
            centrality: metrics?.centrality ?? 0,
            blastRadius: metrics?.blastRadius ?? null,
            inCycle: metrics?.inCycle ?? false,
            domain: metrics?.domain?.domain ?? null,
            isSensitive: file.sensitive,
          };
          const previous = existingByPath.get(file.relPath);
          const unchanged =
            previous !== undefined &&
            previous.contentHash === file.contentHash &&
            previous.analyzerVersion === index.analyzerVersion;
          if (unchanged) {
            await tx.fileNode.update({ where: { id: previous.id }, data: metricData });
            idByPath.set(file.relPath, previous.id);
            continue;
          }
          const data = {
            ...metricData,
            language: file.language ?? file.kind,
            sizeBytes: file.sizeBytes,
            contentHash: file.contentHash,
            analyzerVersion: index.analyzerVersion,
            hasSyntaxErrors: analysis?.hasSyntaxErrors ?? false,
            rawTokens: file.rawTokens,
            l1Tokens: analysis?.l1Tokens ?? null,
            l2Tokens: analysis?.l2Tokens ?? null,
            skeletonL1: analysis?.skeletonL1 ?? null,
            skeletonL2: analysis?.skeletonL2 ?? null,
            imports: (analysis?.imports ?? []) as unknown as Prisma.InputJsonValue,
            exports: analysis?.exports ?? [],
            parsedAt: analysis ? indexedAt : null,
          };
          const node = await tx.fileNode.upsert({
            where: { projectId_relPath: { projectId, relPath: file.relPath } },
            create: { projectId, relPath: file.relPath, ...data },
            update: data,
            select: { id: true },
          });
          idByPath.set(file.relPath, node.id);
          await tx.codeSymbol.deleteMany({ where: { fileId: node.id } });
          for (const symbols of chunks(analysis?.symbols ?? [])) {
            await tx.codeSymbol.createMany({
              data: symbols.map((symbol) => ({ fileId: node.id, ...symbol })),
            });
          }
        }

        await tx.dependencyEdge.deleteMany({ where: { projectId } });
        const edgeRows = index.graph.edges.flatMap((edge) => {
          const fromId = idByPath.get(edge.from);
          if (fromId === undefined) return [];
          return [
            {
              projectId,
              fromId,
              toId: edge.to === null ? null : (idByPath.get(edge.to) ?? null),
              external: edge.external,
              kind: edge.kind,
              specifier: edge.specifier,
              symbols: edge.names,
            },
          ];
        });
        for (const rows of chunks(edgeRows)) await tx.dependencyEdge.createMany({ data: rows });

        await tx.project.update({
          where: { id: projectId },
          data: {
            indexedAt,
            indexStats: index.stats as unknown as Prisma.InputJsonValue,
            indexError: null,
          },
        });
      },
      { timeout: TRANSACTION_TIMEOUT_MS, maxWait: 10_000 },
    );
  }

  async recordFailure(projectId: string, message: string): Promise<void> {
    await this.prisma.project.update({ where: { id: projectId }, data: { indexError: message } });
  }
}
