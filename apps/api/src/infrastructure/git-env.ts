import { chmod, lstat, readdir } from "node:fs/promises";
import { join } from "node:path";
import { DEFAULT_ENV_ALLOWLIST } from "@onyx/agent-runtime";

let sharedUmask: number | null = null;

const GIT_ENV_EXTRAS = ["SSH_AUTH_SOCK", "XDG_CONFIG_HOME", "LC_CTYPE", "LANGUAGE"];

export const GIT_SAFETY_ARGS: readonly string[] = [
  "-c",
  "core.fsmonitor=false",
  "-c",
  "core.hooksPath=/dev/null",
];

export function gitEnvironment(
  source: NodeJS.ProcessEnv = process.env,
  extra: Readonly<Record<string, string>> = {},
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(source)) {
    if (value === undefined) continue;
    if (
      DEFAULT_ENV_ALLOWLIST.includes(name) ||
      GIT_ENV_EXTRAS.includes(name) ||
      name.startsWith("GIT_")
    )
      env[name] = value;
  }
  return { ...env, ...extra };
}

export function safeGitArgs(args: readonly string[]): string[] {
  return [...GIT_SAFETY_ARGS, ...(sharedUmask === null ? [] : ["-c", "safe.directory="]), ...args];
}

const WORK_TREE_COMMANDS = new Set([
  "am",
  "apply",
  "checkout",
  "checkout-index",
  "cherry-pick",
  "merge",
  "mv",
  "pull",
  "read-tree",
  "rebase",
  "reset",
  "restore",
  "revert",
  "stash",
  "switch",
]);

export function shareWorkTrees(umask: number | null): void {
  sharedUmask = umask;
}

export function sharesWorkTrees(): boolean {
  return sharedUmask !== null;
}

export function gitSubcommand(args: readonly string[]): string | null {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? "";
    if (arg === "-c" || arg === "-C") {
      index += 1;
      continue;
    }
    if (!arg.startsWith("-")) return arg;
  }
  return null;
}

export function writesWorkTree(args: readonly string[]): boolean {
  return WORK_TREE_COMMANDS.has(gitSubcommand(args) ?? "");
}

export function withSharedUmask<T>(start: () => T): T {
  if (sharedUmask === null) return start();
  const previous = process.umask(sharedUmask);
  try {
    return start();
  } finally {
    process.umask(previous);
  }
}

async function lockTree(path: string, depth: number): Promise<void> {
  const info = await lstat(path).catch(() => null);
  if (!info || info.isSymbolicLink()) return;
  if ((info.mode & 0o020) !== 0) await chmod(path, info.mode & 0o7757).catch(() => undefined);
  if (!info.isDirectory() || depth === 0) return;
  const entries = await readdir(path).catch(() => []);
  for (const entry of entries) await lockTree(join(path, entry), depth - 1);
}

export async function lockGitMetadata(gitDirs: readonly string[]): Promise<void> {
  if (sharedUmask === null) return;
  for (const gitDir of new Set(gitDirs)) {
    const entries = await readdir(gitDir).catch(() => []);
    for (const entry of entries) await lockTree(join(gitDir, entry), entry === "objects" ? 1 : 16);
    await lockTree(gitDir, 0);
  }
}
