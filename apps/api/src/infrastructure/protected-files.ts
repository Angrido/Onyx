import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { promisify } from "node:util";
import { gitEnvironment, safeGitArgs } from "./git-env";

const execFileAsync = promisify(execFile);

const SKIP_DIRECTORIES = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "coverage",
  ".next",
  ".turbo",
  ".cache",
  "out",
  ".venv",
  "__pycache__",
  ".svelte-kit",
  ".nuxt",
  ".output",
]);
const MAX_WALK_ENTRIES = 100_000;
const MANIFEST = "manifest.json";

export interface SnapshotLimits {
  maxFiles: number;
  maxBytes: number;
}

export const DEFAULT_SNAPSHOT_LIMITS: SnapshotLimits = {
  maxFiles: 5_000,
  maxBytes: 64 * 1024 * 1024,
};

export type ProtectedChangeKind = "modified" | "added" | "removed";

export interface ProtectedChange {
  path: string;
  change: ProtectedChangeKind;
}

function skipped(relPath: string): boolean {
  return relPath
    .split("/")
    .some((segment) => SKIP_DIRECTORIES.has(segment) || segment.startsWith(".onyx-"));
}

async function gitFiles(root: string): Promise<string[] | null> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      safeGitArgs(["ls-files", "-z", "--cached", "--others", "--exclude-standard"]),
      { cwd: root, env: gitEnvironment(), maxBuffer: 64 * 1024 * 1024, timeout: 60_000 },
    );
    return stdout.split("\0").filter((entry) => entry.length > 0 && !skipped(entry));
  } catch {
    return null;
  }
}

async function walk(root: string): Promise<string[]> {
  const files: string[] = [];
  const pending = [root];
  let visited = 0;
  while (pending.length > 0 && visited < MAX_WALK_ENTRIES) {
    const directory = pending.pop();
    if (directory === undefined) break;
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      visited += 1;
      const absolute = join(directory, entry.name);
      const relPath = relative(root, absolute).split("\\").join("/");
      if (entry.isDirectory()) {
        if (!SKIP_DIRECTORIES.has(entry.name) && !entry.name.startsWith(".onyx-"))
          pending.push(absolute);
      } else if (entry.isFile()) {
        files.push(relPath);
      }
    }
  }
  return files;
}

export async function listProjectFiles(root: string): Promise<string[]> {
  return (await gitFiles(root)) ?? (await walk(root));
}

function digest(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

function combinedHash(hashes: ReadonlyMap<string, string>): string {
  const lines = [...hashes.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([path, hash]) => `${path}\0${hash}`);
  return createHash("sha256").update(lines.join("\n")).digest("hex");
}

async function readCurrent(
  root: string,
  isProtected: (relPath: string) => boolean,
): Promise<Map<string, Buffer>> {
  const contents = new Map<string, Buffer>();
  for (const relPath of await listProjectFiles(root)) {
    if (!isProtected(relPath)) continue;
    const content = await readFile(join(root, relPath)).catch(() => null);
    if (content) contents.set(relPath, content);
  }
  return contents;
}

export class ProtectedSnapshot {
  private constructor(
    private readonly root: string,
    private readonly directory: string,
    private readonly hashes: ReadonlyMap<string, string>,
    readonly hash: string,
  ) {}

  get size(): number {
    return this.hashes.size;
  }

  static async capture(
    root: string,
    directory: string,
    isProtected: (relPath: string) => boolean,
    limits: SnapshotLimits = DEFAULT_SNAPSHOT_LIMITS,
  ): Promise<ProtectedSnapshot> {
    const contents = await readCurrent(root, isProtected);
    if (contents.size > limits.maxFiles)
      throw new Error(
        `The project has ${contents.size} test files; the TDD loop protects at most ${limits.maxFiles}`,
      );
    let bytes = 0;
    for (const content of contents.values()) bytes += content.length;
    if (bytes > limits.maxBytes)
      throw new Error(
        `The test files take ${Math.round(bytes / 1_048_576)} MB; the TDD loop protects at most ${Math.round(limits.maxBytes / 1_048_576)} MB`,
      );
    await rm(directory, { recursive: true, force: true });
    await mkdir(join(directory, "files"), { recursive: true, mode: 0o700 });
    const hashes = new Map<string, string>();
    for (const [relPath, content] of contents) {
      const target = join(directory, "files", relPath);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, content);
      hashes.set(relPath, digest(content));
    }
    await writeFile(
      join(directory, MANIFEST),
      JSON.stringify({ root, hashes: Object.fromEntries(hashes) }),
    );
    return new ProtectedSnapshot(root, directory, hashes, combinedHash(hashes));
  }

  static async load(directory: string): Promise<ProtectedSnapshot | null> {
    try {
      const raw: unknown = JSON.parse(await readFile(join(directory, MANIFEST), "utf8"));
      if (typeof raw !== "object" || raw === null) return null;
      const record = raw as Record<string, unknown>;
      const root = record["root"];
      const stored = record["hashes"];
      if (typeof root !== "string" || typeof stored !== "object" || stored === null) return null;
      const hashes = new Map<string, string>();
      for (const [path, hash] of Object.entries(stored)) {
        if (typeof hash === "string") hashes.set(path, hash);
      }
      return new ProtectedSnapshot(root, directory, hashes, combinedHash(hashes));
    } catch {
      return null;
    }
  }

  async verify(isProtected: (relPath: string) => boolean): Promise<ProtectedChange[]> {
    const current = await readCurrent(this.root, isProtected);
    const changes: ProtectedChange[] = [];
    for (const [relPath, hash] of this.hashes) {
      const content = current.get(relPath);
      if (!content) changes.push({ path: relPath, change: "removed" });
      else if (digest(content) !== hash) changes.push({ path: relPath, change: "modified" });
    }
    for (const relPath of current.keys()) {
      if (!this.hashes.has(relPath)) changes.push({ path: relPath, change: "added" });
    }
    return changes.sort((a, b) => a.path.localeCompare(b.path));
  }

  async restore(changes: readonly ProtectedChange[]): Promise<void> {
    for (const { path, change } of changes) {
      const target = join(this.root, path);
      if (change === "added") {
        await unlink(target).catch(() => undefined);
        continue;
      }
      const original = await readFile(join(this.directory, "files", path));
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, original);
    }
  }

  async discard(): Promise<void> {
    await rm(this.directory, { recursive: true, force: true });
  }
}
