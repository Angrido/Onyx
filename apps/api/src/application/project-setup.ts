import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { makeTargetsOf, type StackFacts } from "../domain/stack-commands";
import { LAYOUT_CONTAINERS, type ProjectLayout } from "../domain/workspace-proposal";

const SKIPPED_DIRECTORIES = new Set([
  "node_modules",
  "dist",
  "build",
  "out",
  "coverage",
  "vendor",
  "target",
  "venv",
  ".venv",
  "__pycache__",
  ".next",
  ".turbo",
  ".git",
  ".idea",
  ".vscode",
]);
const MAX_TEXT_BYTES = 256_000;

async function entries(directory: string): Promise<{ directories: string[]; files: string[] }> {
  const listed = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const directories: string[] = [];
  const files: string[] = [];
  for (const entry of listed) {
    if (entry.isDirectory()) {
      if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
      if (entry.name.startsWith(".") && entry.name !== ".github") continue;
      directories.push(entry.name);
    } else if (entry.isFile()) {
      files.push(entry.name);
    }
  }
  return { directories: directories.sort(), files: files.sort() };
}

async function readText(path: string): Promise<string | null> {
  const text = await readFile(path, "utf8").catch(() => null);
  return text === null ? null : text.slice(0, MAX_TEXT_BYTES);
}

export async function readLayout(root: string): Promise<ProjectLayout> {
  const top = await entries(root);
  const children = new Map<string, readonly string[]>();
  for (const container of LAYOUT_CONTAINERS) {
    if (!top.directories.includes(container)) continue;
    children.set(container, (await entries(join(root, container))).directories);
  }
  return { directories: top.directories, files: top.files, children };
}

export async function readStackFacts(root: string): Promise<StackFacts> {
  const top = await entries(root);
  const files = new Set(top.files);
  const packageText = files.has("package.json") ? await readText(join(root, "package.json")) : null;
  let packageJson: Record<string, unknown> | null = null;
  if (packageText !== null) {
    try {
      const parsed: unknown = JSON.parse(packageText);
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed))
        packageJson = parsed as Record<string, unknown>;
    } catch {
      packageJson = null;
    }
  }
  const makefile = files.has("Makefile") ? await readText(join(root, "Makefile")) : null;
  const pyproject = files.has("pyproject.toml")
    ? await readText(join(root, "pyproject.toml"))
    : null;
  return {
    files,
    packageJson,
    makeTargets: makefile === null ? [] : makeTargetsOf(makefile),
    pyproject,
  };
}
