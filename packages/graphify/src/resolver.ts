import { builtinModules } from "node:module";
import { posix } from "node:path";
import type { ImportRef, LanguageId } from "@onyx/lean-ctx";
import {
  discoverWorkspacePackages,
  splitPackageSpecifier,
  TsConfigLoader,
  type ReadText,
  type WorkspacePackage,
} from "./manifests";

export type Resolution =
  | { kind: "internal"; target: string }
  | { kind: "external"; module: string }
  | { kind: "unresolved" };

const SCRIPT_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".d.ts",
  ".js",
  ".jsx",
  ".mts",
  ".mjs",
  ".cts",
  ".cjs",
  ".json",
];

const SOURCE_SWAPS: Readonly<Record<string, readonly string[]>> = {
  ".js": [".ts", ".tsx", ".d.ts"],
  ".jsx": [".tsx"],
  ".mjs": [".mts", ".d.mts"],
  ".cjs": [".cts", ".d.cts"],
};

const BUILD_DIRECTORIES = /^(dist|build|lib|out|esm|cjs)\//;
const EXPORT_CONDITIONS = ["types", "source", "import", "module", "default", "node", "require"];
const NODE_BUILTINS = new Set(builtinModules);
const PYTHON_ROOT_MARKERS = new Set(["pyproject.toml", "setup.py", "setup.cfg"]);

const UNRESOLVED: Resolution = { kind: "unresolved" };

function normalizeRelative(path: string): string | null {
  const normalized = posix.normalize(path);
  if (normalized.startsWith("../") || normalized === ".." || posix.isAbsolute(normalized))
    return null;
  return normalized === "." ? "" : normalized.replace(/^\.\//, "");
}

function joinRelative(base: string, path: string): string | null {
  return normalizeRelative(base.length === 0 ? path : `${base}/${path}`);
}

function stripQuery(specifier: string): string {
  return specifier.replace(/[?#].*$/, "");
}

function pickExportTarget(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    for (const item of value) {
      const target = pickExportTarget(item);
      if (target !== null) return target;
    }
    return null;
  }
  if (value === null || typeof value !== "object") return null;
  const conditions = value as Record<string, unknown>;
  for (const condition of EXPORT_CONDITIONS) {
    if (condition in conditions) {
      const target = pickExportTarget(conditions[condition]);
      if (target !== null) return target;
    }
  }
  return null;
}

function exportTargets(exportsField: unknown, subpath: string): string[] {
  const key = subpath.length === 0 ? "." : `./${subpath}`;
  if (exportsField === null || exportsField === undefined) return [];
  if (typeof exportsField === "string" || Array.isArray(exportsField)) {
    const target = key === "." ? pickExportTarget(exportsField) : null;
    return target === null ? [] : [target];
  }
  if (typeof exportsField !== "object") return [];
  const map = exportsField as Record<string, unknown>;
  const keys = Object.keys(map);
  if (!keys.some((entry) => entry.startsWith("."))) {
    const target = key === "." ? pickExportTarget(map) : null;
    return target === null ? [] : [target];
  }
  if (key in map) {
    const target = pickExportTarget(map[key]);
    return target === null ? [] : [target];
  }
  const targets: string[] = [];
  for (const pattern of keys) {
    const star = pattern.indexOf("*");
    if (star < 0) continue;
    const prefix = pattern.slice(0, star);
    const suffix = pattern.slice(star + 1);
    if (!key.startsWith(prefix) || !key.endsWith(suffix) || key.length < pattern.length - 1)
      continue;
    const captured = key.slice(prefix.length, key.length - suffix.length);
    const target = pickExportTarget(map[pattern]);
    if (target !== null) targets.push(target.split("*").join(captured));
  }
  return targets;
}

export class ModuleResolver {
  private readonly files: ReadonlySet<string>;
  private readonly packages: Map<string, WorkspacePackage>;
  private readonly tsconfigs: TsConfigLoader;
  private readonly pythonRoots: string[];

  constructor(files: Iterable<string>, readText: ReadText) {
    const list = [...files];
    this.files = new Set(list);
    this.packages = discoverWorkspacePackages(list, readText);
    this.tsconfigs = new TsConfigLoader(list, readText, this.packages, this.files);
    this.pythonRoots = this.discoverPythonRoots(list);
  }

  get workspacePackages(): ReadonlyMap<string, WorkspacePackage> {
    return this.packages;
  }

  resolve(fromFile: string, ref: ImportRef, language: LanguageId): Resolution[] {
    return language === "python"
      ? this.resolvePython(fromFile, ref)
      : [this.resolveScript(fromFile, ref.specifier)];
  }

  resolveScript(fromFile: string, rawSpecifier: string): Resolution {
    const specifier = stripQuery(rawSpecifier);
    if (specifier.length === 0) return UNRESOLVED;
    if (specifier.startsWith(".")) {
      const base = joinRelative(
        posix.dirname(fromFile) === "." ? "" : posix.dirname(fromFile),
        specifier,
      );
      const target = base === null ? null : this.resolveFile(base);
      return target === null ? UNRESOLVED : { kind: "internal", target };
    }
    if (specifier.startsWith("/")) return UNRESOLVED;
    if (specifier.startsWith("node:") || NODE_BUILTINS.has(specifier.split("/")[0] ?? "")) {
      return {
        kind: "external",
        module: specifier.startsWith("node:") ? specifier : `node:${specifier}`,
      };
    }

    const viaPaths = this.resolveWithTsConfig(fromFile, specifier);
    if (viaPaths !== null) return { kind: "internal", target: viaPaths };

    const parsed = splitPackageSpecifier(specifier);
    if (!parsed) return UNRESOLVED;
    const pkg = this.packages.get(parsed.name);
    if (pkg) {
      const target = this.resolvePackage(pkg, parsed.subpath);
      if (target !== null) return { kind: "internal", target };
    }
    return { kind: "external", module: parsed.name };
  }

  private resolveFile(base: string): string | null {
    if (this.files.has(base) && !base.endsWith("/")) return base;
    const extension = posix.extname(base);
    for (const swap of SOURCE_SWAPS[extension] ?? []) {
      const candidate = `${base.slice(0, -extension.length)}${swap}`;
      if (this.files.has(candidate)) return candidate;
    }
    for (const suffix of SCRIPT_EXTENSIONS) {
      if (this.files.has(`${base}${suffix}`)) return `${base}${suffix}`;
    }
    const indexBase = base.length === 0 ? "index" : `${base}/index`;
    for (const suffix of SCRIPT_EXTENSIONS) {
      if (this.files.has(`${indexBase}${suffix}`)) return `${indexBase}${suffix}`;
    }
    return null;
  }

  private resolveWithTsConfig(fromFile: string, specifier: string): string | null {
    const config = this.tsconfigs.nearest(fromFile);
    if (!config) return null;
    for (const [pattern, replacements] of Object.entries(config.paths)) {
      const star = pattern.indexOf("*");
      let captured: string | null = null;
      if (star < 0) {
        if (pattern === specifier) captured = "";
      } else {
        const prefix = pattern.slice(0, star);
        const suffix = pattern.slice(star + 1);
        if (specifier.startsWith(prefix) && specifier.endsWith(suffix)) {
          captured = specifier.slice(prefix.length, specifier.length - suffix.length);
        }
      }
      if (captured === null) continue;
      for (const replacement of replacements) {
        const base = joinRelative(config.pathsBase, replacement.split("*").join(captured));
        const target = base === null ? null : this.resolveFile(base);
        if (target !== null) return target;
      }
    }
    if (config.baseUrl !== null) {
      const base = joinRelative(config.baseUrl, specifier);
      return base === null ? null : this.resolveFile(base);
    }
    return null;
  }

  private resolvePackage(pkg: WorkspacePackage, subpath: string): string | null {
    const candidates = [
      ...exportTargets(pkg.exports, subpath),
      ...(subpath.length === 0 ? pkg.entryFields : [subpath]),
    ];
    for (const candidate of candidates) {
      const relative = candidate.replace(/^\.\//, "");
      for (const variant of [relative, relative.replace(BUILD_DIRECTORIES, "src/")]) {
        const base = joinRelative(pkg.dir, variant.replace(/\.d\.([cm]?)ts$/, ".$1js"));
        const target = base === null ? null : this.resolveFile(base);
        if (target !== null) return target;
      }
    }
    const fallback = joinRelative(pkg.dir, subpath.length === 0 ? "src/index" : `src/${subpath}`);
    const target = fallback === null ? null : this.resolveFile(fallback);
    if (target !== null) return target;
    const root = joinRelative(pkg.dir, subpath.length === 0 ? "index" : subpath);
    return root === null ? null : this.resolveFile(root);
  }

  private discoverPythonRoots(files: readonly string[]): string[] {
    const roots = new Set<string>(["", "src"]);
    for (const file of files) {
      if (!PYTHON_ROOT_MARKERS.has(posix.basename(file))) continue;
      const dir = posix.dirname(file) === "." ? "" : posix.dirname(file);
      roots.add(dir);
      roots.add(dir.length === 0 ? "src" : `${dir}/src`);
    }
    return [...roots];
  }

  private pythonModule(base: string): string | null {
    for (const candidate of [
      `${base}.py`,
      `${base}.pyi`,
      `${base}/__init__.py`,
      `${base}/__init__.pyi`,
    ]) {
      if (this.files.has(candidate)) return candidate;
    }
    return null;
  }

  private resolvePython(fromFile: string, ref: ImportRef): Resolution[] {
    const specifier = ref.specifier;
    const dots = /^\.*/.exec(specifier)?.[0].length ?? 0;
    const modulePath = specifier
      .slice(dots)
      .split(".")
      .filter((part) => part.length > 0)
      .join("/");

    const bases: string[] = [];
    if (dots > 0) {
      let dir = posix.dirname(fromFile) === "." ? "" : posix.dirname(fromFile);
      for (let level = 1; level < dots; level += 1) {
        if (dir.length === 0) return [UNRESOLVED];
        dir = posix.dirname(dir) === "." ? "" : posix.dirname(dir);
      }
      const base = modulePath.length === 0 ? dir : joinRelative(dir, modulePath);
      if (base === null) return [UNRESOLVED];
      bases.push(base);
    } else {
      for (const root of this.pythonRoots) {
        const base = joinRelative(root, modulePath);
        if (base !== null) bases.push(base);
      }
    }

    for (const base of bases) {
      const submodules: Resolution[] = [];
      for (const name of ref.names) {
        if (name === "*") continue;
        const target = this.pythonModule(base.length === 0 ? name : `${base}/${name}`);
        if (target !== null) submodules.push({ kind: "internal", target });
      }
      const module = base.length === 0 ? null : this.pythonModule(base);
      const own: Resolution[] = module === null ? [] : [{ kind: "internal", target: module }];
      if (submodules.length > 0 && submodules.length === ref.names.length) return submodules;
      if (submodules.length > 0 || own.length > 0) return [...own, ...submodules];
    }
    if (dots > 0) return [UNRESOLVED];
    return [{ kind: "external", module: specifier.split(".")[0] ?? specifier }];
  }
}
