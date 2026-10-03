import { execFileSync } from "node:child_process";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpToolName, McpToolResult } from "@onyx/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createOnyxMcpServer, HttpToolClient, type ToolClient } from "../src";

const PACKAGE_DIR = fileURLToPath(new URL("..", import.meta.url));
const BUNDLE = fileURLToPath(new URL("../dist/onyx-mcp.js", import.meta.url));

interface RecordedCall {
  tool: McpToolName;
  input: Record<string, unknown>;
}

class FakeClient implements ToolClient {
  readonly calls: RecordedCall[] = [];
  constructor(private readonly respond: (call: RecordedCall) => McpToolResult) {}

  async call(tool: McpToolName, input: Record<string, unknown>): Promise<McpToolResult> {
    const call = { tool, input };
    this.calls.push(call);
    return this.respond(call);
  }
}

async function connect(client: ToolClient): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await createOnyxMcpServer(client).connect(serverTransport);
  const mcp = new Client({ name: "test", version: "1.0.0" });
  await mcp.connect(clientTransport);
  return mcp;
}

function textOf(result: Awaited<ReturnType<Client["callTool"]>>): string {
  const content = result.content as { type: string; text?: string }[];
  return content.map((part) => part.text ?? "").join("");
}

interface ApiRequest {
  url: string;
  authorization: string | undefined;
  body: unknown;
}

async function readBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

let api: Server;
let apiUrl: string;
const apiRequests: ApiRequest[] = [];

beforeAll(async () => {
  api = createServer(async (request, response) => {
    const body = await readBody(request);
    apiRequests.push({
      url: request.url ?? "",
      authorization: request.headers.authorization,
      body,
    });
    response.setHeader("content-type", "application/json");
    if (request.headers.authorization !== "Bearer good-token") {
      response.statusCode = 401;
      response.end(
        JSON.stringify({ code: "UNAUTHORIZED", message: "Unknown or expired run token" }),
      );
      return;
    }
    response.end(JSON.stringify({ text: `ok ${request.url}`, tokens: 7, isError: false }));
  });
  await new Promise<void>((resolve) => api.listen(0, "127.0.0.1", resolve));
  apiUrl = `http://127.0.0.1:${(api.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise((resolve) => api.close(resolve));
});

describe("onyx MCP server", () => {
  it("exposes the four read-only context tools", async () => {
    const mcp = await connect(new FakeClient(() => ({ text: "", tokens: 0, isError: false })));
    const { tools } = await mcp.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      "deps",
      "expand_symbol",
      "file_skeleton",
      "search_symbols",
    ]);
    expect(tools.every((tool) => tool.annotations?.readOnlyHint === true)).toBe(true);
    await mcp.close();
  });

  it("forwards arguments and relays results and errors", async () => {
    const fake = new FakeClient((call) =>
      call.tool === "expand_symbol"
        ? { text: "10  return 1;", tokens: 4, isError: false }
        : { text: "Unknown file: nope.ts", tokens: 0, isError: true },
    );
    const mcp = await connect(fake);
    const expanded = await mcp.callTool({
      name: "expand_symbol",
      arguments: { handle: "k3j9x0a2" },
    });
    expect(textOf(expanded)).toBe("10  return 1;");
    expect(expanded.isError).toBe(false);
    const missing = await mcp.callTool({
      name: "file_skeleton",
      arguments: { path: "nope.ts", level: 2 },
    });
    expect(missing.isError).toBe(true);
    expect(fake.calls).toEqual([
      { tool: "expand_symbol", input: { handle: "k3j9x0a2" } },
      { tool: "file_skeleton", input: { path: "nope.ts", level: 2 } },
    ]);
    await mcp.close();
  });

  it("reports an unreachable API as a tool error instead of crashing", async () => {
    const failing: ToolClient = {
      call: () => Promise.reject(new Error("connect ECONNREFUSED")),
    };
    const mcp = await connect(failing);
    const result = await mcp.callTool({ name: "deps", arguments: { path: "a.ts" } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("ECONNREFUSED");
    await mcp.close();
  });
});

describe("HttpToolClient", () => {
  it("posts to the internal endpoint with the run token", async () => {
    const client = new HttpToolClient({ apiUrl: `${apiUrl}/`, token: "good-token" });
    await expect(client.call("search_symbols", { query: "Run" })).resolves.toEqual({
      text: "ok /internal/mcp/search_symbols",
      tokens: 7,
      isError: false,
    });
    expect(apiRequests.at(-1)).toEqual({
      url: "/internal/mcp/search_symbols",
      authorization: "Bearer good-token",
      body: { query: "Run" },
    });
  });

  it("turns API errors into tool errors", async () => {
    const client = new HttpToolClient({ apiUrl, token: "bad-token" });
    await expect(client.call("deps", { path: "a.ts" })).resolves.toEqual({
      text: "Unknown or expired run token",
      tokens: 0,
      isError: true,
    });
  });
});

describe("bundled onyx-mcp", () => {
  beforeAll(() => {
    execFileSync("pnpm", ["exec", "tsup"], { cwd: PACKAGE_DIR, stdio: "ignore" });
  }, 120_000);

  it("runs over stdio as a standalone file", async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [BUNDLE],
      env: { ONYX_API_URL: apiUrl, ONYX_RUN_TOKEN: "good-token", PATH: process.env["PATH"] ?? "" },
    });
    const mcp = new Client({ name: "bundle-test", version: "1.0.0" });
    await mcp.connect(transport);
    const result = await mcp.callTool({ name: "expand_symbol", arguments: { handle: "abcdefgh" } });
    expect(textOf(result)).toBe("ok /internal/mcp/expand_symbol");
    await mcp.close();
  });
});
