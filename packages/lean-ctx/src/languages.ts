export type LanguageId = "typescript" | "tsx" | "javascript" | "python";

export const SUPPORTED_LANGUAGES: readonly LanguageId[] = [
  "typescript",
  "tsx",
  "javascript",
  "python",
];

const PARSEABLE_EXTENSIONS: Readonly<Record<string, LanguageId>> = {
  ".ts": "typescript",
  ".mts": "typescript",
  ".cts": "typescript",
  ".tsx": "tsx",
  ".js": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".jsx": "javascript",
  ".py": "python",
  ".pyi": "python",
};

const OTHER_FILE_KINDS: Readonly<Record<string, string>> = {
  ".json": "json",
  ".jsonc": "json",
  ".md": "markdown",
  ".mdx": "markdown",
  ".css": "css",
  ".scss": "css",
  ".html": "html",
  ".yml": "yaml",
  ".yaml": "yaml",
  ".toml": "toml",
  ".sql": "sql",
  ".prisma": "prisma",
  ".sh": "shell",
  ".go": "go",
  ".rs": "rust",
  ".java": "java",
  ".kt": "kotlin",
  ".rb": "ruby",
  ".php": "php",
  ".c": "c",
  ".h": "c",
  ".cpp": "cpp",
  ".cs": "csharp",
  ".svg": "svg",
  ".txt": "text",
};

function extensionOf(relPath: string): string {
  const name = relPath.slice(relPath.lastIndexOf("/") + 1).toLowerCase();
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? "" : name.slice(dot);
}

export function detectLanguage(relPath: string): LanguageId | null {
  return PARSEABLE_EXTENSIONS[extensionOf(relPath)] ?? null;
}

export function detectFileKind(relPath: string): string | null {
  const extension = extensionOf(relPath);
  const language = PARSEABLE_EXTENSIONS[extension];
  if (language) return language;
  const kind = OTHER_FILE_KINDS[extension];
  if (kind) return kind;
  const name = relPath.slice(relPath.lastIndexOf("/") + 1);
  if (name === "Dockerfile" || name.startsWith("Dockerfile.")) return "dockerfile";
  if (name === "Makefile") return "makefile";
  return null;
}

export function isDeclarationFile(relPath: string): boolean {
  return /\.d\.[cm]?ts$/.test(relPath);
}
