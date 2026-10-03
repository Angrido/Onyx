import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LeanAnalyzer } from "@onyx/lean-ctx";
import {
  buildContextPack,
  indexProject,
  type PackFile,
  type PreviousFile,
  type ProjectIndex,
} from "../src";

const analyzer = new LeanAnalyzer();
const fakeWebhook = [
  "https://hooks.slack.com/services/",
  "T00000000/B00000000/",
  "X".repeat(24),
].join("");

const longBody = Array.from(
  { length: 40 },
  (_, index) => `  total += options.retries * ${index};`,
).join("\n");

const PROJECT: Record<string, string> = {
  ".gitignore": "dist/\n",
  "package.json": JSON.stringify({ name: "demo", type: "module" }),
  "tsconfig.json": JSON.stringify({ compilerOptions: { strict: true } }),
  "dist/bundle.js": "console.log('built');\n",
  "src/index.ts": 'export * from "./types";\nexport { run } from "./service";\n',
  "src/types.ts":
    "export type Mode = 'fast' | 'safe';\nexport interface Options {\n  mode: Mode;\n  retries: number;\n}\n",
  "src/util.ts":
    "export function clamp(value: number): number {\n  return Math.max(0, value);\n}\n",
  "src/service.ts": [
    'import type { Options } from "./types";',
    'import { clamp } from "./util";',
    "export function run(options: Options): number {",
    "  let total = 0;",
    longBody,
    "  return clamp(total);",
    "}",
    "export function unused(): void {}",
    "",
  ].join("\n"),
  "src/main.ts":
    'import { run, type Options } from "./index";\nexport const options: Options = { mode: "fast", retries: 1 };\nexport const result = run(options);\n',
  "src/cli.ts":
    'import { result } from "./main";\nexport function print(): void {\n  console.log(result);\n}\n',
  "src/hooks.ts": `export const SLACK_HOOK = "${fakeWebhook}";\n`,
};

let root: string;
let index: ProjectIndex;

function packFiles(source: ProjectIndex): Map<string, PackFile> {
  return new Map(
    [...source.files].map(([relPath, file]) => [
      relPath,
      {
        relPath,
        language: file.language ?? file.kind,
        rawTokens: file.rawTokens,
        l1Tokens: file.analysis?.l1Tokens ?? null,
        l2Tokens: file.analysis?.l2Tokens ?? null,
        skeletonL1: file.analysis?.skeletonL1 ?? null,
        skeletonL2: file.analysis?.skeletonL2 ?? null,
        exports: file.analysis?.exports ?? [],
        typeNames: (file.analysis?.symbols ?? [])
          .filter(
            (symbol) => symbol.exported && ["interface", "type", "enum"].includes(symbol.kind),
          )
          .map((symbol) => symbol.name),
        sensitive: file.sensitive,
      },
    ]),
  );
}

async function writeProject(dir: string, files: Record<string, string>): Promise<void> {
  for (const [relPath, content] of Object.entries(files)) {
    await mkdir(dirname(join(dir, relPath)), { recursive: true });
    await writeFile(join(dir, relPath), content);
  }
}

function previousOf(source: ProjectIndex): Map<string, PreviousFile> {
  return new Map(
    [...source.files].map(([relPath, file]) => [
      relPath,
      {
        contentHash: file.contentHash,
        analyzerVersion: source.analyzerVersion,
        analysis: file.analysis,
      },
    ]),
  );
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "onyx-graphify-"));
  await writeProject(root, PROJECT);
  index = await indexProject({ rootDir: root, analyzer });
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("indexProject", () => {
  it("enumerates through repomix, honouring .gitignore", () => {
    expect([...index.files.keys()].sort()).toEqual(
      Object.keys(PROJECT)
        .filter((path) => !path.startsWith("dist/"))
        .sort(),
    );
    expect(index.stats.parsedFiles).toBe(7);
  });

  it("flags files with secrets as sensitive", () => {
    expect(index.files.get("src/hooks.ts")?.sensitive).toBe(true);
    expect(index.files.get("src/service.ts")?.sensitive).toBe(false);
    expect(index.stats.sensitiveFiles).toBe(1);
  });

  it("links imports into the dependency graph and ranks shared modules", () => {
    expect(index.graph.dependencies("src/main.ts")).toEqual(["src/index.ts"]);
    expect(index.graph.dependencies("src/index.ts").sort()).toEqual([
      "src/service.ts",
      "src/types.ts",
    ]);
    expect(index.metrics.get("src/types.ts")?.blastRadius).toBe(4);
    expect(index.metrics.get("src/types.ts")?.centrality ?? 0).toBeGreaterThan(
      index.metrics.get("src/cli.ts")?.centrality ?? 1,
    );
  });

  it("reuses previous analyses for unchanged files", async () => {
    await writeFile(join(root, "src/util.ts"), `${PROJECT["src/util.ts"]}export const ZERO = 0;\n`);
    const again = await indexProject({ rootDir: root, analyzer, previous: previousOf(index) });
    expect(again.stats.reusedFiles).toBe(9);
    expect(again.stats.parsedFiles).toBe(1);
    expect(again.files.get("src/util.ts")?.analysis?.exports).toContain("ZERO");
    await writeFile(join(root, "src/util.ts"), PROJECT["src/util.ts"] ?? "");
  });

  it("stops when aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      indexProject({ rootDir: root, analyzer, signal: controller.signal }),
    ).rejects.toThrow();
  });
});

describe("buildContextPack", () => {
  const rank = () =>
    new Map([...index.metrics].map(([path, metrics]) => [path, metrics.centrality]));
  const readSource = (relPath: string) => PROJECT[relPath] ?? null;

  it("sends targets in full and only the imported contracts of dependencies", () => {
    const pack = buildContextPack({
      targets: ["src/main.ts"],
      graph: index.graph,
      files: packFiles(index),
      readSource,
      rank: rank(),
      estimator: analyzer.estimator,
      excerpt: (relPath, level, names) =>
        analyzer.excerpt(relPath, readSource(relPath) ?? "", level, names),
    });
    expect(pack).not.toBeNull();
    const levels = Object.fromEntries(
      (pack?.entries ?? []).map((entry) => [entry.relPath, [entry.role, entry.level]]),
    );
    expect(levels).toEqual({
      "src/main.ts": ["target", 3],
      "src/types.ts": ["dependency", 2],
      "src/service.ts": ["dependency", 1],
      "src/cli.ts": ["dependent", 1],
      "src/util.ts": ["nearby", 0],
    });
    expect(pack?.text).toContain("### src/service.ts (signatures: run)");
    expect(pack?.text).toContain("export function run(options: Options): number { …#");
    expect(pack?.text).not.toContain("unused");
    expect(pack?.text).not.toContain("total += options.retries");
    expect(pack?.baselineTokens ?? 0).toBeGreaterThan(pack?.deliveredTokens ?? Infinity);
  });

  it("never ships the content of sensitive files", () => {
    const pack = buildContextPack({
      targets: ["src/hooks.ts"],
      graph: index.graph,
      files: packFiles(index),
      readSource,
      rank: rank(),
      estimator: analyzer.estimator,
    });
    expect(pack?.entries[0]).toMatchObject({ relPath: "src/hooks.ts", level: 0 });
    expect(pack?.text).not.toContain("hooks.slack.com");
  });

  it("degrades neighbours to fit the budget but always keeps the targets", () => {
    const pack = buildContextPack({
      targets: ["src/service.ts"],
      graph: index.graph,
      files: packFiles(index),
      readSource,
      rank: rank(),
      estimator: analyzer.estimator,
      budgetTokens: 1_000,
    });
    expect(pack?.entries[0]).toMatchObject({ relPath: "src/service.ts", level: 3 });
    expect(pack?.entries.reduce((sum, entry) => sum + entry.tokens, 0)).toBeLessThanOrEqual(1_000);
  });

  it("returns null without known targets", () => {
    expect(
      buildContextPack({
        targets: ["src/missing.ts"],
        graph: index.graph,
        files: packFiles(index),
        readSource: () => null,
        rank: rank(),
        estimator: analyzer.estimator,
      }),
    ).toBeNull();
  });
});

describe("oversized targets", () => {
  it("fall back to contracts when the full source would eat the budget", () => {
    const pack = buildContextPack({
      targets: ["src/service.ts"],
      graph: index.graph,
      files: packFiles(index),
      readSource: (relPath) => PROJECT[relPath] ?? null,
      rank: new Map(),
      estimator: analyzer.estimator,
      budgetTokens: 300,
    });
    expect(pack?.entries[0]).toMatchObject({ relPath: "src/service.ts", level: 2 });
  });
});

describe("projects nested in another repository", () => {
  it("ignore the parent's .gitignore but honour their own", async () => {
    const parent = await mkdtemp(join(tmpdir(), "onyx-parent-"));
    try {
      await mkdir(join(parent, ".git"));
      await writeFile(join(parent, ".gitignore"), "data/\n");
      const nested = join(parent, "data", "project");
      await writeProject(nested, {
        ".gitignore": "generated/\n*.log\n",
        "src/app.ts": "export const app = 1;\n",
        "src/generated/types.ts": "export type T = 1;\n",
        "debug.log": "noise\n",
      });
      const result = await indexProject({ rootDir: nested, analyzer, securityCheck: false });
      expect([...result.files.keys()].sort()).toEqual([".gitignore", "src/app.ts"]);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });
});
