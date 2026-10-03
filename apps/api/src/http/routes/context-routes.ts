import {
  DepsInputSchema,
  ExpandSymbolInputSchema,
  FileContextQuerySchema,
  FileSkeletonInputSchema,
  GraphQuerySchema,
  MCP_TOOL_NAMES,
  SearchSymbolsInputSchema,
  type FileContextDto,
  type GraphResponse,
  type IndexStatusDto,
  type McpToolName,
  type McpToolResult,
} from "@onyx/contracts";
import type { ContextLevel } from "@onyx/lean-ctx";
import type { ContextPolicy } from "@onyx/ignore-compiler";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ProjectContext } from "../../application/project-context";
import type { Container } from "../../container";
import { conflict, notFound } from "../../errors";
import { requireGrant } from "../internal-auth";
import { idParam } from "../params";

const ToolParamsSchema = z.object({ tool: z.enum(MCP_TOOL_NAMES) });

function runTool(
  context: ProjectContext,
  tool: McpToolName,
  body: unknown,
  policy: ContextPolicy,
): McpToolResult {
  switch (tool) {
    case "expand_symbol":
      return context.expandSymbol(ExpandSymbolInputSchema.parse(body), policy);
    case "file_skeleton":
      return context.fileSkeleton(FileSkeletonInputSchema.parse(body), policy);
    case "deps":
      return context.deps(DepsInputSchema.parse(body), policy);
    case "search_symbols":
      return context.searchSymbols(SearchSymbolsInputSchema.parse(body), policy);
  }
}

export function registerContextRoutes(app: FastifyInstance, container: Container): void {
  const { indexes, runTokens } = container;

  const requireContext = async (projectId: string): Promise<ProjectContext> => {
    const context = await indexes.context(projectId);
    if (context) return context;
    await indexes.status(projectId);
    throw conflict("The project has not been indexed yet");
  };

  app.get("/api/projects/:id/index", async (request): Promise<IndexStatusDto> =>
    indexes.status(idParam(request.params)),
  );

  app.post("/api/projects/:id/index", async (request, reply): Promise<IndexStatusDto> => {
    const status = await indexes.start(idParam(request.params));
    reply.status(202);
    return status;
  });

  app.get("/api/projects/:id/graph", async (request): Promise<GraphResponse> => {
    const query = GraphQuerySchema.parse(request.query);
    const context = await requireContext(idParam(request.params));
    return context.graph({ focus: query.focus ?? null, depth: query.depth, limit: query.limit });
  });

  app.get("/api/projects/:id/context", async (request): Promise<FileContextDto> => {
    const query = FileContextQuerySchema.parse(request.query);
    const context = await requireContext(idParam(request.params));
    const file = context.fileContext(query.path, query.level as ContextLevel);
    if (!file) throw notFound("File");
    return file;
  });

  app.post(
    "/internal/mcp/:tool",
    { config: { public: true } },
    async (request): Promise<McpToolResult> => {
      const { token, grant } = requireGrant(request, runTokens);
      const { tool } = ToolParamsSchema.parse(request.params);
      const context = await indexes.context(grant.projectId);
      if (!context) {
        return { text: "The project index is not available right now.", tokens: 0, isError: true };
      }
      const result = runTool(context, tool, request.body ?? {}, grant.policy);
      runTokens.record(token, result.tokens);
      request.log.info(
        { runId: grant.runId, tool, tokens: result.tokens, isError: result.isError },
        "MCP tool call",
      );
      return result;
    },
  );
}
