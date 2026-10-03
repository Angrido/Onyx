import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { RunSettings } from "../domain/permission-rules";

export interface RuntimeFiles {
  directory: string;
  settingsFile: string;
  mcpConfigFile: string;
  primerFile: string | null;
}

export interface RuntimeFilesInput {
  runtimeDir: string;
  runId: string;
  settings: RunSettings;
  primer: string | null;
}

export async function writeRuntimeFiles(input: RuntimeFilesInput): Promise<RuntimeFiles> {
  const directory = join(input.runtimeDir, input.runId);
  await mkdir(directory, { recursive: true, mode: 0o700 });

  const settingsFile = join(directory, "settings.json");
  await writeFile(settingsFile, `${JSON.stringify(input.settings, null, 2)}\n`, { mode: 0o600 });

  const mcpConfigFile = join(directory, "mcp.json");
  await writeFile(mcpConfigFile, `${JSON.stringify({ mcpServers: {} }, null, 2)}\n`, {
    mode: 0o600,
  });

  let primerFile: string | null = null;
  if (input.primer !== null && input.primer.trim().length > 0) {
    primerFile = join(directory, "primer.md");
    await writeFile(primerFile, `${input.primer.trim()}\n`, { mode: 0o600 });
  }

  return { directory, settingsFile, mcpConfigFile, primerFile };
}
