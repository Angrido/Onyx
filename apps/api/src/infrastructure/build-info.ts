import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { gitEnvironment, safeGitArgs } from "./git-env";

const execFileAsync = promisify(execFile);
const PACKAGE_NAME = "@onyx/api";
const MAX_LEVELS = 5;

export interface BuildInfo {
  version: string | null;
  commit: string | null;
}

async function packageRoot(
  start: string,
): Promise<{ root: string; version: string | null } | null> {
  let directory = start;
  for (let level = 0; level < MAX_LEVELS; level += 1) {
    const text = await readFile(join(directory, "package.json"), "utf8").catch(() => null);
    if (text !== null) {
      try {
        const parsed = JSON.parse(text) as { name?: unknown; version?: unknown };
        if (parsed.name === PACKAGE_NAME)
          return {
            root: directory,
            version: typeof parsed.version === "string" ? parsed.version : null,
          };
      } catch {
        return null;
      }
    }
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return null;
}

async function revisionOf(root: string): Promise<string | null> {
  const text = await readFile(join(root, "..", "REVISION"), "utf8").catch(() => null);
  const revision = text?.trim() ?? "";
  if (/^[A-Za-z0-9._-]{1,64}$/.test(revision)) return revision;
  try {
    const { stdout } = await execFileAsync("git", safeGitArgs(["rev-parse", "--short", "HEAD"]), {
      cwd: root,
      timeout: 2_000,
      env: gitEnvironment(),
    });
    const commit = stdout.trim();
    return /^[0-9a-f]{4,40}$/.test(commit) ? commit : null;
  } catch {
    return null;
  }
}

export async function readBuildInfo(start: string = import.meta.dirname): Promise<BuildInfo> {
  const found = await packageRoot(start);
  if (!found) return { version: null, commit: null };
  return { version: found.version, commit: await revisionOf(found.root) };
}
