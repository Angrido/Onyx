import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { collectFiles, mergeConfigs, runSecurityCheck, searchFiles, setLogLevel } from "repomix";

export interface EnumeratedFile {
  relPath: string;
  content: string;
  sizeBytes: number;
}

export interface SkippedFile {
  relPath: string;
  reason: string;
}

export interface SecurityFinding {
  relPath: string;
  messages: string[];
}

export interface EnumerationResult {
  files: EnumeratedFile[];
  skipped: SkippedFile[];
  findings: SecurityFinding[];
}

export interface EnumerateOptions {
  ignorePatterns?: readonly string[];
  maxFileBytes?: number;
  securityCheck?: boolean;
}

const DEFAULT_MAX_FILE_BYTES = 1024 * 1024;
const SILENT = -1;

export const HARD_SKIP_PATTERNS: readonly string[] = [
  ".git/**",
  ".hg/**",
  ".svn/**",
  "**/node_modules/**",
  "**/bower_components/**",
  "**/jspm_packages/**",
  "**/.pnpm-store/**",
  "**/.yarn/**",
  "**/.venv/**",
  "**/venv/**",
  "**/__pycache__/**",
  "**/*.py[cod]",
  "**/.DS_Store",
  "**/.env",
  "**/.env.*",
  "**/*.pem",
  "**/*.key",
  "**/*.p12",
  "**/*.pfx",
  "**/id_rsa*",
  "**/id_ed25519*",
];

const GITIGNORE_SCAN_DEPTH = 8;
const GITIGNORE_SCAN_SKIP = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  ".venv",
  "venv",
]);

let silenced = false;

function isGitRoot(directory: string): boolean {
  return existsSync(join(directory, ".git"));
}

function hasAncestorRepository(rootDir: string): boolean {
  let current = dirname(resolve(rootDir));
  for (;;) {
    if (isGitRoot(current)) return true;
    const parent = dirname(current);
    if (parent === current) return false;
    current = parent;
  }
}

export function gitignoreToGlobs(content: string, baseDir: string): string[] {
  const globs: string[] = [];
  const prefix = baseDir.length === 0 ? "" : `${baseDir}/`;
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#") || trimmed.startsWith("!")) continue;
    const pattern = trimmed.replace(/\/+$/, "");
    if (pattern.length === 0) continue;
    const anchored = pattern.includes("/");
    const relative = pattern.replace(/^\//, "");
    const base = anchored ? `${prefix}${relative}` : `${prefix}**/${relative}`;
    globs.push(base, `${base}/**`);
  }
  return globs;
}

async function projectGitignoreGlobs(rootDir: string): Promise<string[]> {
  const globs: string[] = [];
  const walk = async (relative: string, depth: number): Promise<void> => {
    const absolute = relative.length === 0 ? rootDir : join(rootDir, relative);
    const entries = await readdir(absolute, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.isFile() && entry.name === ".gitignore") {
        const content = await readFile(join(absolute, entry.name), "utf8").catch(() => "");
        globs.push(...gitignoreToGlobs(content, relative));
      } else if (
        entry.isDirectory() &&
        depth < GITIGNORE_SCAN_DEPTH &&
        !GITIGNORE_SCAN_SKIP.has(entry.name)
      ) {
        await walk(relative.length === 0 ? entry.name : `${relative}/${entry.name}`, depth + 1);
      }
    }
  };
  await walk("", 0);
  return globs;
}

function silenceRepomix(): void {
  if (silenced) return;
  setLogLevel(SILENT);
  silenced = true;
}

export async function enumerateProject(
  rootDir: string,
  options: EnumerateOptions = {},
): Promise<EnumerationResult> {
  silenceRepomix();
  const nestedInForeignRepository = !isGitRoot(rootDir) && hasAncestorRepository(rootDir);
  const localGitignore = nestedInForeignRepository ? await projectGitignoreGlobs(rootDir) : [];
  const config = mergeConfigs(
    rootDir,
    {},
    {
      input: { maxFileSize: options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES },
      ignore: {
        useGitignore: !nestedInForeignRepository,
        useDefaultPatterns: false,
        customPatterns: [
          ...HARD_SKIP_PATTERNS,
          ...(options.ignorePatterns ?? []),
          ...localGitignore,
        ],
      },
      security: { enableSecurityCheck: options.securityCheck ?? true },
    },
  );
  const search = await searchFiles(rootDir, config);
  const collected = await collectFiles(search.filePaths, rootDir, config);

  const files = collected.rawFiles.map((file) => ({
    relPath: file.path.split("\\").join("/"),
    content: file.content,
    sizeBytes: Buffer.byteLength(file.content, "utf8"),
  }));
  const skipped = collected.skippedFiles.map((file) => ({
    relPath: file.path.split("\\").join("/"),
    reason: file.reason,
  }));
  const findings =
    options.securityCheck === false
      ? []
      : (await runSecurityCheck(collected.rawFiles))
          .filter((result) => result.type === "file")
          .map((result) => ({
            relPath: result.filePath.split("\\").join("/"),
            messages: result.messages,
          }));

  return { files, skipped, findings };
}
