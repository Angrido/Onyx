import { posix } from "node:path";
import { parse as parseJsonc } from "jsonc-parser";

export type ReadText = (relPath: string) => string | null;

export interface WorkspacePackage {
  name: string;
  dir: string;
  exports: unknown;
  entryFields: string[];
}

export interface TsPathConfig {
  configPath: string;
  baseUrl: string | null;
  paths: Record<string, string[]>;
  pathsBase: string;
}

interface RawTsConfig {
  extends?: string | string[];
  compilerOptions?: {
    baseUrl?: string;
    paths?: Record<string, string[]>;
  };
}

const ENTRY_FIELDS = ["source", "types", "typings", "module", "main"] as const;
const MAX_EXTENDS_DEPTH = 8;

function parseLenient<T>(text: string): T | null {
  const value = parseJsonc(text, [], {
    allowTrailingComma: true,
    disallowComments: false,
  }) as unknown;
  return value !== null && typeof value === "object" ? (value as T) : null;
}

export function discoverWorkspacePackages(
  files: Iterable<string>,
  readText: ReadText,
): Map<string, WorkspacePackage> {
  const packages = new Map<string, WorkspacePackage>();
  for (const relPath of files) {
    if (posix.basename(relPath) !== "package.json" || relPath.includes("node_modules/")) continue;
    const text = readText(relPath);
    if (text === null) continue;
    const manifest = parseLenient<Record<string, unknown>>(text);
    const name = manifest?.["name"];
    if (!manifest || typeof name !== "string" || packages.has(name)) continue;
    const entryFields: string[] = [];
    for (const field of ENTRY_FIELDS) {
      const value = manifest[field];
      if (typeof value === "string") entryFields.push(value);
    }
    packages.set(name, {
      name,
      dir: posix.dirname(relPath) === "." ? "" : posix.dirname(relPath),
      exports: manifest["exports"] ?? null,
      entryFields,
    });
  }
  return packages;
}

export function splitPackageSpecifier(specifier: string): { name: string; subpath: string } | null {
  const parts = specifier.split("/");
  const scoped = specifier.startsWith("@");
  const nameParts = scoped ? parts.slice(0, 2) : parts.slice(0, 1);
  if (nameParts.some((part) => part.length === 0) || (scoped && nameParts.length < 2)) return null;
  return {
    name: nameParts.join("/"),
    subpath: parts.slice(nameParts.length).join("/"),
  };
}

export class TsConfigLoader {
  private readonly cache = new Map<string, TsPathConfig | null>();
  private readonly configFiles: Set<string>;

  constructor(
    files: Iterable<string>,
    private readonly readText: ReadText,
    private readonly packages: ReadonlyMap<string, WorkspacePackage>,
    private readonly fileSet: ReadonlySet<string>,
  ) {
    this.configFiles = new Set(
      [...files].filter((file) => /(^|\/)(tsconfig|jsconfig)\.json$/.test(file)),
    );
  }

  nearest(fromFile: string): TsPathConfig | null {
    let dir = posix.dirname(fromFile);
    for (;;) {
      const prefix = dir === "." ? "" : `${dir}/`;
      for (const name of ["tsconfig.json", "jsconfig.json"]) {
        const candidate = `${prefix}${name}`;
        if (this.configFiles.has(candidate)) return this.load(candidate);
      }
      if (dir === "." || dir === "") return null;
      dir = posix.dirname(dir);
    }
  }

  private load(configPath: string, depth = 0): TsPathConfig | null {
    if (this.cache.has(configPath)) return this.cache.get(configPath) ?? null;
    this.cache.set(configPath, null);
    const text = this.readText(configPath);
    const raw = text === null ? null : parseLenient<RawTsConfig>(text);
    if (!raw) return null;

    const configDir = posix.dirname(configPath) === "." ? "" : posix.dirname(configPath);
    let inherited: TsPathConfig | null = null;
    const parents = raw.extends === undefined ? [] : [raw.extends].flat();
    if (depth < MAX_EXTENDS_DEPTH) {
      for (const parent of parents) {
        const parentPath = this.resolveExtends(configDir, parent);
        const loaded = parentPath === null ? null : this.load(parentPath, depth + 1);
        if (loaded) inherited = { ...loaded, configPath };
      }
    }

    const options = raw.compilerOptions ?? {};
    const baseUrl =
      typeof options.baseUrl === "string"
        ? posix.normalize(posix.join(configDir, options.baseUrl))
        : (inherited?.baseUrl ?? null);
    const ownPaths = options.paths && typeof options.paths === "object" ? options.paths : null;
    const result: TsPathConfig = {
      configPath,
      baseUrl: baseUrl === "." ? "" : baseUrl,
      paths: ownPaths ?? inherited?.paths ?? {},
      pathsBase: ownPaths ? (baseUrl ?? configDir) : (inherited?.pathsBase ?? baseUrl ?? configDir),
    };
    if (result.pathsBase === ".") result.pathsBase = "";
    this.cache.set(configPath, result);
    return result;
  }

  private resolveExtends(configDir: string, specifier: string): string | null {
    const withJson = (path: string) => (path.endsWith(".json") ? path : `${path}.json`);
    if (specifier.startsWith(".")) {
      const target = posix.normalize(posix.join(configDir, specifier));
      if (this.fileSet.has(target)) return target;
      return this.fileSet.has(withJson(target)) ? withJson(target) : null;
    }
    const parsed = splitPackageSpecifier(specifier);
    const pkg = parsed ? this.packages.get(parsed.name) : undefined;
    if (!parsed || !pkg) return null;
    const target = posix.join(
      pkg.dir,
      parsed.subpath.length > 0 ? parsed.subpath : "tsconfig.json",
    );
    if (this.fileSet.has(target)) return target;
    return this.fileSet.has(withJson(target)) ? withJson(target) : null;
  }
}
