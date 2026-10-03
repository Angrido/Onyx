import { accessSync, constants } from "node:fs";

export const ONYX_MCP_SERVER_NAME = "onyx";
export const ONYX_MCP_ALLOW_RULE = `mcp__${ONYX_MCP_SERVER_NAME}`;

export interface McpLaunch {
  serverPath: string;
  apiUrl: string;
  token: string;
  nodePath?: string;
}

export interface McpConfigFile {
  mcpServers: Record<
    string,
    { type: "stdio"; command: string; args: string[]; env: Record<string, string> }
  >;
}

export function emptyMcpConfig(): McpConfigFile {
  return { mcpServers: {} };
}

export function buildMcpConfig(launch: McpLaunch): McpConfigFile {
  return {
    mcpServers: {
      [ONYX_MCP_SERVER_NAME]: {
        type: "stdio",
        command: launch.nodePath ?? process.execPath,
        args: [launch.serverPath],
        env: { ONYX_API_URL: launch.apiUrl, ONYX_RUN_TOKEN: launch.token },
      },
    },
  };
}

export function isReadableFile(path: string | null): path is string {
  if (path === null) return false;
  try {
    accessSync(path, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}
