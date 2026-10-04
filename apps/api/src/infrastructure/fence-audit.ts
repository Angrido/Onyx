import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { sharesWorkTrees } from "./git-env";
import { GitRepo } from "./git-worktree";

const MAX_SNAPSHOT_BYTES = 64 * 1024 * 1024;

export interface FenceSnapshot {
  root: string;
  dirty: ReadonlySet<string>;
  contents: ReadonlyMap<string, Buffer | null>;
}

export interface FenceReview {
  restored: string[];
  removed: string[];
  skipped: string[];
}

function digest(content: Buffer | null): string | null {
  return content === null ? null : createHash("sha256").update(content).digest("hex");
}

async function readOrNull(path: string): Promise<Buffer | null> {
  return readFile(path).catch(() => null);
}

export async function dirtyPaths(repo: GitRepo): Promise<Set<string> | null> {
  let output: string;
  try {
    output = await repo.run(["status", "--porcelain", "-z", "-uall", "--no-renames"]);
  } catch {
    return null;
  }
  const paths = new Set<string>();
  for (const entry of output.split("\0")) {
    if (entry.length > 3) paths.add(entry.slice(3));
  }
  return paths;
}

export async function captureFence(
  root: string,
  fenced: (relPath: string) => boolean,
  env: NodeJS.ProcessEnv = process.env,
): Promise<FenceSnapshot | null> {
  const repo = new GitRepo(root, env);
  const dirty = await dirtyPaths(repo);
  if (dirty === null) return null;
  const contents = new Map<string, Buffer | null>();
  let total = 0;
  for (const path of dirty) {
    if (!fenced(path)) continue;
    const content = await readOrNull(join(root, path));
    total += content?.length ?? 0;
    if (total > MAX_SNAPSHOT_BYTES) break;
    contents.set(path, content);
  }
  return { root, dirty, contents };
}

async function inHead(repo: GitRepo, path: string): Promise<boolean> {
  try {
    await repo.run(["cat-file", "-e", `HEAD:${path}`]);
    return true;
  } catch {
    return false;
  }
}

export async function reviewFence(
  snapshot: FenceSnapshot,
  fenced: (relPath: string) => boolean,
  exempt: (relPath: string) => boolean,
  env: NodeJS.ProcessEnv = process.env,
): Promise<FenceReview> {
  const repo = new GitRepo(snapshot.root, env);
  const review: FenceReview = { restored: [], removed: [], skipped: [] };
  const after = await dirtyPaths(repo);
  if (after === null) return review;
  const candidates = [...new Set([...after, ...snapshot.contents.keys()])].filter(
    (path) => fenced(path) && !exempt(path),
  );
  for (const path of candidates.sort()) {
    const absolute = join(snapshot.root, path);
    const current = await readOrNull(absolute);
    if (!snapshot.dirty.has(path)) {
      if (await inHead(repo, path)) {
        await repo.run(["restore", "--source=HEAD", "--staged", "--worktree", "--", path]);
        review.restored.push(path);
      } else if (current !== null) {
        await rm(absolute, { force: true });
        review.removed.push(path);
      }
      continue;
    }
    if (!snapshot.contents.has(path)) {
      review.skipped.push(path);
      continue;
    }
    const before = snapshot.contents.get(path) ?? null;
    if (digest(before) === digest(current)) continue;
    if (before === null) {
      await rm(absolute, { force: true });
      review.removed.push(path);
    } else {
      await mkdir(dirname(absolute), { recursive: true });
      await writeFile(absolute, before);
      if (sharesWorkTrees()) await chmod(absolute, 0o660).catch(() => undefined);
      review.restored.push(path);
    }
  }
  return review;
}
