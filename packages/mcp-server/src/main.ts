import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { HttpToolClient } from "./client";
import { createOnyxMcpServer } from "./server";

const apiUrl = process.env["ONYX_API_URL"];
const token = process.env["ONYX_RUN_TOKEN"];

if (!apiUrl || !token) {
  console.error("onyx-mcp needs ONYX_API_URL and ONYX_RUN_TOKEN");
  process.exit(2);
}

const server = createOnyxMcpServer(new HttpToolClient({ apiUrl, token }));
await server.connect(new StdioServerTransport());
