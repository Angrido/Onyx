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

let silenced = false;

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
  const config = mergeConfigs(
    rootDir,
    {},
    {
      input: { maxFileSize: options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES },
      ignore: { customPatterns: [...(options.ignorePatterns ?? [])] },
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
