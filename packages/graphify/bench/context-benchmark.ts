import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { LeanAnalyzer, type SkeletonLevel } from "@onyx/lean-ctx";
import { buildContextPack, indexProject, type PackFile, type ProjectIndex } from "../src";

interface Sample {
  target: string;
  targetTokens: number;
  baselineTokens: number;
  deliveredTokens: number;
  neighbourBaseline: number;
  neighbourDelivered: number;
  files: number;
}

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    samples: { type: "string", default: "25" },
    budget: { type: "string", default: "24000" },
    json: { type: "string" },
  },
});

const MIN_TARGET_TOKENS = 200;
const MAX_TARGET_TOKENS = 12_000;

function stableOrder(path: string): string {
  return createHash("sha1").update(path).digest("hex");
}

function packFiles(index: ProjectIndex): Map<string, PackFile> {
  return new Map(
    [...index.files].map(([relPath, file]) => [
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
            (symbol) =>
              symbol.exported &&
              !symbol.qualifiedName.includes(".") &&
              ["interface", "type", "enum"].includes(symbol.kind),
          )
          .map((symbol) => symbol.name),
        sensitive: file.sensitive,
      },
    ]),
  );
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : (sorted[middle] ?? 0);
}

function percent(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`;
}

async function benchmark(rootDir: string): Promise<Record<string, unknown>> {
  const analyzer = new LeanAnalyzer();
  const index = await indexProject({ rootDir, analyzer });
  const files = packFiles(index);
  const rank = new Map([...index.metrics].map(([path, metrics]) => [path, metrics.centrality]));
  const readSource = (relPath: string) => {
    try {
      return readFileSync(join(rootDir, relPath), "utf8");
    } catch {
      return null;
    }
  };
  const excerpt = (relPath: string, level: SkeletonLevel, names: readonly string[]) => {
    const content = readSource(relPath);
    return content === null ? null : analyzer.excerpt(relPath, content, level, names);
  };

  const candidates = [...index.files.values()]
    .filter(
      (file) =>
        file.analysis !== null &&
        !file.sensitive &&
        file.rawTokens >= MIN_TARGET_TOKENS &&
        file.rawTokens <= MAX_TARGET_TOKENS &&
        index.graph.outDegree(file.relPath) > 0 &&
        !/(^|\/)(tests?|__tests__|spec|fixtures?)\//.test(file.relPath) &&
        !/\.(test|spec)\.[jt]sx?$|_test\.py$|(^|\/)test_[^/]+\.py$/.test(file.relPath),
    )
    .map((file) => file.relPath)
    .sort((a, b) => stableOrder(a).localeCompare(stableOrder(b)))
    .slice(0, Number(values.samples));

  const samples: Sample[] = [];
  for (const target of candidates) {
    const pack = buildContextPack({
      targets: [target],
      graph: index.graph,
      files,
      readSource,
      rank,
      estimator: analyzer.estimator,
      budgetTokens: Number(values.budget),
      excerpt,
    });
    if (!pack) continue;
    const targetTokens = files.get(target)?.rawTokens ?? 0;
    const targetEntry = pack.entries.find((entry) => entry.relPath === target);
    samples.push({
      target,
      targetTokens,
      baselineTokens: pack.baselineTokens,
      deliveredTokens: pack.deliveredTokens,
      neighbourBaseline: pack.baselineTokens - targetTokens,
      neighbourDelivered: pack.deliveredTokens - (targetEntry?.tokens ?? 0),
      files: pack.entries.length,
    });
  }

  const totalBaseline = samples.reduce((sum, sample) => sum + sample.baselineTokens, 0);
  const totalDelivered = samples.reduce((sum, sample) => sum + sample.deliveredTokens, 0);
  const neighbourBaseline = samples.reduce((sum, sample) => sum + sample.neighbourBaseline, 0);
  const neighbourDelivered = samples.reduce((sum, sample) => sum + sample.neighbourDelivered, 0);
  return {
    repository: basename(rootDir),
    files: index.stats.files,
    parsedFiles: index.stats.parsedFiles,
    symbols: index.stats.symbols,
    internalEdges: index.stats.internalEdges,
    indexMs: index.stats.durationMs,
    skeletonSaving: (() => {
      const parsed = [...index.files.values()].filter((file) => file.analysis !== null);
      const raw = parsed.reduce((sum, file) => sum + file.rawTokens, 0);
      const skeleton = parsed.reduce((sum, file) => sum + (file.analysis?.l1Tokens ?? 0), 0);
      return raw > 0 ? 1 - skeleton / raw : 0;
    })(),
    samples: samples.length,
    totalBaseline,
    totalDelivered,
    packSaving: 1 - totalDelivered / totalBaseline,
    medianPackSaving: median(
      samples.map((sample) => 1 - sample.deliveredTokens / sample.baselineTokens),
    ),
    neighbourSaving: neighbourBaseline > 0 ? 1 - neighbourDelivered / neighbourBaseline : 0,
    details: samples,
  };
}

const results = [];
for (const directory of positionals) results.push(await benchmark(resolve(directory)));

const header =
  "| Repository | Files | Symbols | Imports | Index | L1 vs parsed code | Tasks | Naive context | Onyx pack | Saving (total) | Saving (median) | Saving on neighbours |";
const divider = `|${"---|".repeat(12)}`;
const rows = results.map((result) =>
  [
    result["repository"],
    result["files"],
    result["symbols"],
    result["internalEdges"],
    `${((result["indexMs"] as number) / 1000).toFixed(1)} s`,
    `−${percent(result["skeletonSaving"] as number)}`,
    result["samples"],
    (result["totalBaseline"] as number).toLocaleString("en-US"),
    (result["totalDelivered"] as number).toLocaleString("en-US"),
    `−${percent(result["packSaving"] as number)}`,
    `−${percent(result["medianPackSaving"] as number)}`,
    `−${percent(result["neighbourSaving"] as number)}`,
  ].join(" | "),
);
process.stdout.write(`${[header, divider, ...rows.map((row) => `| ${row} |`)].join("\n")}\n`);
if (values.json) writeFileSync(values.json, `${JSON.stringify(results, null, 2)}\n`);
