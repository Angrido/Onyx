import { readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { indexProject } from "@onyx/graphify";
import { ContextPolicy, presetRules, SECURITY_RULES } from "@onyx/ignore-compiler";
import { AdjustableTokenEstimator, LeanAnalyzer } from "@onyx/lean-ctx";
import { fitCalibration, stableSample } from "../src/application/calibration-service";
import { O200kTokenizer, type ReferenceTokenizer } from "../src/infrastructure/token-meter";

interface Sample {
  relPath: string;
  kind: string | null;
  text: string;
  rawTokens: number;
  measured: number;
}

interface SubsetResult {
  name: string;
  files: number;
  measured: number;
  before: number;
  inSample: number;
  heldOut: number;
}

interface RepoResult {
  repo: string;
  files: number;
  measured: number;
  preset: SubsetResult;
  directories: SubsetResult[];
}

const TOLERANCE = 0.15;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    json: { type: "string" },
    "min-tokens": { type: "string", default: "2000" },
  },
});

class CachedTokenizer implements ReferenceTokenizer {
  readonly name: ReferenceTokenizer["name"];
  private readonly cache = new Map<string, number>();

  constructor(private readonly inner: ReferenceTokenizer) {
    this.name = inner.name;
  }

  async count(texts: readonly string[]): Promise<number[]> {
    const missing = texts.filter((text) => !this.cache.has(text));
    const counts = await this.inner.count(missing);
    missing.forEach((text, index) => this.cache.set(text, counts[index] ?? 0));
    return texts.map((text) => this.cache.get(text) ?? 0);
  }
}

async function calibratedEstimator(
  samples: readonly Sample[],
  tokenizer: ReferenceTokenizer,
): Promise<AdjustableTokenEstimator> {
  const calibration = await fitCalibration(stableSample(samples), tokenizer);
  const estimator = new AdjustableTokenEstimator();
  estimator.setRatios(calibration.ratios);
  return estimator;
}

async function evaluateSubset(
  name: string,
  subset: readonly Sample[],
  all: readonly Sample[],
  inSample: AdjustableTokenEstimator,
  tokenizer: ReferenceTokenizer,
): Promise<SubsetResult> {
  const members = new Set(subset.map((sample) => sample.relPath));
  const heldOut = await calibratedEstimator(
    all.filter((sample) => !members.has(sample.relPath)),
    tokenizer,
  );
  const sum = (pick: (sample: Sample) => number) =>
    subset.reduce((total, sample) => total + pick(sample), 0);
  return {
    name,
    files: subset.length,
    measured: sum((sample) => sample.measured),
    before: sum((sample) => sample.rawTokens),
    inSample: sum((sample) => inSample.estimate(sample.text, sample.kind)),
    heldOut: sum((sample) => heldOut.estimate(sample.text, sample.kind)),
  };
}

function directoriesOf(relPath: string): string[] {
  const segments = relPath.split("/").slice(0, -1);
  return segments.slice(0, 2).map((_, index) => segments.slice(0, index + 1).join("/"));
}

async function benchmark(rootDir: string, minTokens: number): Promise<RepoResult> {
  const tokenizer = new CachedTokenizer(new O200kTokenizer());
  const index = await indexProject({
    rootDir,
    analyzer: new LeanAnalyzer({ estimator: new AdjustableTokenEstimator() }),
  });
  const candidates = [...index.files.values()].filter((file) => !file.binary && !file.sensitive);
  const texts = candidates.map((file) => readFileSync(join(rootDir, file.relPath), "utf8"));
  const measured = await tokenizer.count(texts);
  const samples: Sample[] = candidates
    .map((file, position) => ({
      relPath: file.relPath,
      kind: file.language ?? file.kind,
      text: texts[position] ?? "",
      rawTokens: file.rawTokens,
      measured: measured[position] ?? 0,
    }))
    .filter((sample) => sample.text.length > 0);

  const inSample = await calibratedEstimator(samples, tokenizer);
  const policy = ContextPolicy.compose(presetRules("aggressive"), SECURITY_RULES);
  const preset = await evaluateSubset(
    "aggressive preset",
    samples.filter((sample) => policy.isExcluded(sample.relPath)),
    samples,
    inSample,
    tokenizer,
  );

  const groups = new Map<string, Sample[]>();
  for (const sample of samples) {
    for (const directory of directoriesOf(sample.relPath)) {
      const group = groups.get(directory) ?? [];
      group.push(sample);
      groups.set(directory, group);
    }
  }
  const directories: SubsetResult[] = [];
  for (const [directory, group] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
    const tokens = group.reduce((total, sample) => total + sample.measured, 0);
    if (tokens < minTokens || group.length === samples.length) continue;
    directories.push(await evaluateSubset(directory, group, samples, inSample, tokenizer));
  }
  return {
    repo: basename(rootDir),
    files: samples.length,
    measured: samples.reduce((total, sample) => total + sample.measured, 0),
    preset,
    directories,
  };
}

function error(estimate: number, measured: number): number {
  return measured === 0 ? 0 : estimate / measured - 1;
}

function percent(value: number): string {
  return `${value >= 0 ? "+" : "−"}${Math.abs(value * 100).toFixed(1)}%`;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length === 0) return 0;
  return sorted.length % 2 === 1
    ? (sorted[middle] ?? 0)
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

function summary(results: readonly SubsetResult[], pick: (result: SubsetResult) => number) {
  const errors = results.map((result) => Math.abs(error(pick(result), result.measured)));
  const within = errors.filter((value) => value <= TOLERANCE).length;
  return {
    median: median(errors),
    max: Math.max(0, ...errors),
    within: results.length === 0 ? 1 : within / results.length,
  };
}

function render(results: readonly RepoResult[]): string {
  const lines = [
    "| Repository | Files | Measured tokens | Preset excluded | Preset error (heuristic → calibrated → held-out) | Directories | |error| median heuristic | |error| median calibrated | |error| median held-out | Max held-out | Within ±15% (held-out) |",
    "|---|---|---|---|---|---|---|---|---|---|---|",
  ];
  for (const result of results) {
    const { preset } = result;
    const before = summary(result.directories, (item) => item.before);
    const calibrated = summary(result.directories, (item) => item.inSample);
    const heldOut = summary(result.directories, (item) => item.heldOut);
    const presetCell =
      preset.files === 0
        ? "—"
        : `${percent(error(preset.before, preset.measured))} → ${percent(error(preset.inSample, preset.measured))} → ${percent(error(preset.heldOut, preset.measured))}`;
    lines.push(
      `| ${result.repo} | ${result.files} | ${result.measured.toLocaleString("en-US")} | ${preset.files} files, ${preset.measured.toLocaleString("en-US")} tokens | ${presetCell} | ${result.directories.length} | ${(before.median * 100).toFixed(1)}% | ${(calibrated.median * 100).toFixed(1)}% | ${(heldOut.median * 100).toFixed(1)}% | ${(heldOut.max * 100).toFixed(1)}% | ${Math.round(heldOut.within * 100)}% |`,
    );
  }
  return lines.join("\n");
}

const minTokens = Number(values["min-tokens"]);
const results: RepoResult[] = [];
for (const directory of positionals) {
  const result = await benchmark(resolve(directory), minTokens);
  results.push(result);
  process.stdout.write(
    `${result.repo}: ${result.files} files, ${result.directories.length} directories\n`,
  );
}
process.stdout.write(`\n${render(results)}\n`);
if (values.json) writeFileSync(values.json, JSON.stringify(results, null, 2));
