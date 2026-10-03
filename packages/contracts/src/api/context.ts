import { z } from "zod";
import { DomainSchema } from "../domain";
import { ContextLevelSchema } from "../stream-json/run-items";

export const IndexPhaseSchema = z.enum([
  "enumerating",
  "analyzing",
  "linking",
  "ranking",
  "saving",
]);
export type IndexPhase = z.infer<typeof IndexPhaseSchema>;

export const IndexProgressSchema = z.object({
  phase: IndexPhaseSchema,
  done: z.number().int(),
  total: z.number().int(),
});
export type IndexProgress = z.infer<typeof IndexProgressSchema>;

export const IndexStatsSchema = z.object({
  files: z.number().int(),
  parsedFiles: z.number().int(),
  reusedFiles: z.number().int(),
  skippedFiles: z.number().int(),
  binaryFiles: z.number().int().default(0),
  syntaxErrorFiles: z.number().int(),
  symbols: z.number().int(),
  internalEdges: z.number().int(),
  externalModules: z.number().int(),
  rawTokens: z.number().int(),
  l1Tokens: z.number().int(),
  cycles: z.number().int(),
  sensitiveFiles: z.number().int(),
  durationMs: z.number().int(),
});
export type IndexStats = z.infer<typeof IndexStatsSchema>;

export const IndexStateSchema = z.enum(["never", "indexing", "ready", "failed"]);
export type IndexState = z.infer<typeof IndexStateSchema>;

export const IndexStatusDtoSchema = z.object({
  projectId: z.string(),
  state: IndexStateSchema,
  indexedAt: z.string().nullable(),
  stats: IndexStatsSchema.nullable(),
  error: z.string().nullable(),
  progress: IndexProgressSchema.nullable(),
});
export type IndexStatusDto = z.infer<typeof IndexStatusDtoSchema>;

export const IndexProgressEventSchema = z.object({
  projectId: z.string(),
  state: IndexStateSchema,
  progress: IndexProgressSchema.nullable(),
  stats: IndexStatsSchema.nullable(),
  error: z.string().nullable(),
});
export type IndexProgressEvent = z.infer<typeof IndexProgressEventSchema>;

export const GraphQuerySchema = z.object({
  focus: z.string().min(1).max(1024).optional(),
  depth: z.coerce.number().int().min(1).max(4).default(2),
  limit: z.coerce.number().int().min(10).max(5_000).default(1_500),
});
export type GraphQuery = z.input<typeof GraphQuerySchema>;

export const GraphNodeDtoSchema = z.object({
  id: z.string(),
  language: z.string().nullable(),
  rawTokens: z.number().int(),
  l1Tokens: z.number().int().nullable(),
  symbols: z.number().int(),
  inDegree: z.number().int(),
  outDegree: z.number().int(),
  centrality: z.number(),
  blastRadius: z.number().int().nullable(),
  domain: DomainSchema.nullable(),
  inCycle: z.boolean(),
  sensitive: z.boolean(),
  distance: z.number().int().nullable(),
});
export type GraphNodeDto = z.infer<typeof GraphNodeDtoSchema>;

export const EdgeKindSchema = z.enum([
  "STATIC_IMPORT",
  "DYNAMIC_IMPORT",
  "REQUIRE",
  "REEXPORT",
  "TYPE_ONLY",
]);
export type EdgeKind = z.infer<typeof EdgeKindSchema>;

export const GraphEdgeDtoSchema = z.object({
  from: z.string(),
  to: z.string(),
  kind: EdgeKindSchema,
});
export type GraphEdgeDto = z.infer<typeof GraphEdgeDtoSchema>;

export const GraphResponseSchema = z.object({
  projectId: z.string(),
  indexedAt: z.string().nullable(),
  focus: z.string().nullable(),
  depth: z.number().int(),
  totalNodes: z.number().int(),
  truncated: z.boolean(),
  nodes: z.array(GraphNodeDtoSchema),
  edges: z.array(GraphEdgeDtoSchema),
  cycles: z.array(z.array(z.string())),
  externalModules: z.array(z.object({ name: z.string(), importers: z.number().int() })),
  proposedWorkspaceGlobs: z.record(z.string(), z.array(z.string())),
});
export type GraphResponse = z.infer<typeof GraphResponseSchema>;

export const SymbolDtoSchema = z.object({
  handle: z.string(),
  name: z.string(),
  qualifiedName: z.string(),
  kind: z.string(),
  signature: z.string(),
  startLine: z.number().int(),
  endLine: z.number().int(),
  bodyTokens: z.number().int(),
  exported: z.boolean(),
});
export type SymbolDto = z.infer<typeof SymbolDtoSchema>;

export const FileContextQuerySchema = z.object({
  path: z.string().min(1).max(1024),
  level: z.coerce.number().int().min(0).max(3).default(1),
});
export type FileContextQuery = z.input<typeof FileContextQuerySchema>;

export const FileContextDtoSchema = z.object({
  relPath: z.string(),
  language: z.string().nullable(),
  level: ContextLevelSchema,
  content: z.string(),
  tokens: z.number().int(),
  rawTokens: z.number().int(),
  l1Tokens: z.number().int().nullable(),
  l2Tokens: z.number().int().nullable(),
  sensitive: z.boolean(),
  domain: DomainSchema.nullable(),
  centrality: z.number().nullable(),
  blastRadius: z.number().int().nullable(),
  dependencies: z.array(z.string()),
  dependents: z.array(z.string()),
  externalImports: z.array(z.string()),
  symbols: z.array(SymbolDtoSchema),
});
export type FileContextDto = z.infer<typeof FileContextDtoSchema>;

export const ExpandSymbolInputSchema = z
  .object({
    handle: z
      .string()
      .regex(/^#?[0-9a-z]{8}$/)
      .optional(),
    path: z.string().min(1).max(1024).optional(),
    qualifiedName: z.string().min(1).max(512).optional(),
  })
  .refine(
    (value) =>
      value.handle !== undefined || (value.path !== undefined && value.qualifiedName !== undefined),
    "Pass a handle, or a path together with a qualifiedName",
  );
export type ExpandSymbolInput = z.infer<typeof ExpandSymbolInputSchema>;

export const FileSkeletonInputSchema = z.object({
  path: z.string().min(1).max(1024),
  level: z.union([z.literal(0), z.literal(1), z.literal(2)]).default(1),
});
export type FileSkeletonInput = z.input<typeof FileSkeletonInputSchema>;

export const DepsInputSchema = z.object({
  path: z.string().min(1).max(1024),
  direction: z.enum(["in", "out", "both"]).default("both"),
  depth: z.number().int().min(1).max(3).default(1),
});
export type DepsInput = z.input<typeof DepsInputSchema>;

export const SearchSymbolsInputSchema = z.object({
  query: z.string().trim().min(2).max(128),
  kind: z
    .enum(["function", "method", "class", "interface", "type", "enum", "variable", "namespace"])
    .optional(),
  limit: z.number().int().min(1).max(50).default(20),
});
export type SearchSymbolsInput = z.input<typeof SearchSymbolsInputSchema>;

export const McpToolResultSchema = z.object({
  text: z.string(),
  tokens: z.number().int(),
  isError: z.boolean(),
});
export type McpToolResult = z.infer<typeof McpToolResultSchema>;

export const MCP_TOOL_NAMES = ["expand_symbol", "file_skeleton", "deps", "search_symbols"] as const;
export type McpToolName = (typeof MCP_TOOL_NAMES)[number];
