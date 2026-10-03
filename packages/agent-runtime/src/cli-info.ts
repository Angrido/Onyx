import { execFile } from "node:child_process";
import type { ClaudeBinary } from "./run-spec";

const VERSION_PATTERN = /\d+\.\d+\.\d+(?:-[\w.]+)?/;

export function parseCliVersion(output: string): string | null {
  return VERSION_PATTERN.exec(output)?.[0] ?? null;
}

export function detectCliVersion(binary: ClaudeBinary, timeoutMs = 10_000): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      binary.command,
      [...binary.args, "--version"],
      { timeout: timeoutMs, env: { ...process.env, DISABLE_AUTOUPDATER: "1" } },
      (error, stdout) => {
        resolve(error ? null : parseCliVersion(stdout));
      },
    );
  });
}
