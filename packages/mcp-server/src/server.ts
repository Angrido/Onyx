import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpToolName } from "@onyx/contracts";
import { z } from "zod";
import type { ToolClient } from "./client";

export const SERVER_NAME = "onyx";
export const SERVER_VERSION = "0.2.0";

const SYMBOL_KINDS = [
  "function",
  "method",
  "class",
  "interface",
  "type",
  "enum",
  "variable",
  "namespace",
] as const;

const TOOLS = {
  expand_symbol: {
    title: "Expand symbol",
    description:
      "Full source of one symbol with line numbers. Pass the handle shown as `…#handle` in Onyx skeletons, or a path with a qualifiedName such as Class.method.",
    inputSchema: {
      handle: z.string().optional().describe("Handle from an elided body, e.g. k3j9x0a2"),
      path: z.string().optional().describe("File path relative to the project root"),
      qualifiedName: z.string().optional().describe("Symbol name, e.g. RunExecutor.prepare"),
    },
  },
  file_skeleton: {
    title: "File skeleton",
    description:
      "Outline of a file without bodies, far cheaper than reading it: level 1 = signatures, 2 = contracts (types, interfaces, first doc lines), 0 = exports and symbol handles.",
    inputSchema: {
      path: z.string().describe("File path relative to the project root"),
      level: z.union([z.literal(0), z.literal(1), z.literal(2)]).optional(),
    },
  },
  deps: {
    title: "Import graph neighbourhood",
    description:
      "Files a file imports (out), files importing it (in) and external packages, from the Onyx import graph.",
    inputSchema: {
      path: z.string().describe("File path relative to the project root"),
      direction: z.enum(["in", "out", "both"]).optional(),
      depth: z.number().int().min(1).max(3).optional(),
    },
  },
  search_symbols: {
    title: "Search symbols",
    description:
      "Find declarations by name across the indexed project. Returns handles for expand_symbol.",
    inputSchema: {
      query: z.string().min(2).describe("Name or part of a name"),
      kind: z.enum(SYMBOL_KINDS).optional(),
      limit: z.number().int().min(1).max(50).optional(),
    },
  },
} as const;

function withoutUndefined(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
}

export function createOnyxMcpServer(client: ToolClient): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
  for (const [name, definition] of Object.entries(TOOLS) as [
    McpToolName,
    (typeof TOOLS)[McpToolName],
  ][]) {
    server.registerTool(
      name,
      {
        title: definition.title,
        description: definition.description,
        inputSchema: definition.inputSchema,
        annotations: { readOnlyHint: true, openWorldHint: false },
      },
      async (input: Record<string, unknown>) => {
        try {
          const result = await client.call(name, withoutUndefined(input));
          return {
            content: [{ type: "text" as const, text: result.text }],
            isError: result.isError,
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return {
            content: [{ type: "text" as const, text: `Onyx is unreachable: ${message}` }],
            isError: true,
          };
        }
      },
    );
  }
  return server;
}
