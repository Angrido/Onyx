import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { RunSettings } from "../domain/permission-rules";
import { emptyMcpConfig, type McpConfigFile } from "./mcp-config";

export interface RuntimeFiles {
  directory: string;
  settingsFile: string;
  mcpConfigFile: string;
  primerFile: string | null;
  contextFile: string | null;
  agentsFile: string | null;
}

export interface RuntimeFilesInput {
  runtimeDir: string;
  runId: string;
  settings: RunSettings;
  primer: string | null;
  mcpConfig?: McpConfigFile;
  contextPack?: string | null;
  agents?: Record<string, unknown> | null;
}

export async function writeRuntimeFiles(input: RuntimeFilesInput): Promise<RuntimeFiles> {
  const directory = join(input.runtimeDir, input.runId);
  await mkdir(directory, { recursive: true, mode: 0o750 });

  const settingsFile = join(directory, "settings.json");
  await writeFile(settingsFile, `${JSON.stringify(input.settings, null, 2)}\n`, { mode: 0o640 });

  const mcpConfigFile = join(directory, "mcp.json");
  await writeFile(
    mcpConfigFile,
    `${JSON.stringify(input.mcpConfig ?? emptyMcpConfig(), null, 2)}\n`,
    { mode: 0o640 },
  );

  let primerFile: string | null = null;
  if (input.primer !== null && input.primer.trim().length > 0) {
    primerFile = join(directory, "primer.md");
    await writeFile(primerFile, `${input.primer.trim()}\n`, { mode: 0o640 });
  }

  let contextFile: string | null = null;
  if (input.contextPack) {
    contextFile = join(directory, "context-pack.md");
    await writeFile(contextFile, `${input.contextPack}\n`, { mode: 0o640 });
  }

  let agentsFile: string | null = null;
  if (input.agents && Object.keys(input.agents).length > 0) {
    agentsFile = join(directory, "agents.json");
    await writeFile(agentsFile, `${JSON.stringify(input.agents, null, 2)}\n`, { mode: 0o640 });
  }

  return { directory, settingsFile, mcpConfigFile, primerFile, contextFile, agentsFile };
}
