import type {
  ArmStats,
  ContextArm,
  ContextExperimentSettings,
  ContextRole,
  ExperimentResult,
  ExperimentState,
  MemoryExperiment,
  OtherSavings,
  PackAccounting,
  SavingsCheck,
  SavingsLedgerRow,
  SavingsVerdict,
} from "@onyx/contracts";
import { msg, tx } from "../i18n";

export const DEFAULT_EXPERIMENT: ContextExperimentSettings = {
  enabled: false,
  controlShare: 0.25,
  variant: null,
};
export const MIN_RUNS_PER_ARM = 10;
export const SIGNIFICANCE = 0.05;
export const MAX_REREAD_PATHS = 50;

const BASELINE_ROLES: ReadonlySet<ContextRole> = new Set(["target", "dependency"]);
const REREAD_WARNING_SHARE = 0.25;
const COVERAGE_WARNING_SHARE = 0.5;
const SUCCESS_GAP_WARNING = -0.1;

export function drawArm(input: {
  settings: ContextExperimentSettings;
  freshSession: boolean;
  contextEnabled: boolean;
  random: () => number;
}): ContextArm | null {
  if (!input.settings.enabled || !input.freshSession || !input.contextEnabled) return null;
  const draw = input.random();
  const { controlShare, variant } = input.settings;
  if (draw < controlShare) return "CONTROL";
  if (variant === null) return "PACK";
  return draw < controlShare + (1 - controlShare) / 2 ? "PACK" : variant;
}

function pairState(input: {
  enabled: boolean;
  treated: ArmStats;
  reference: ArmStats;
  change: number | null;
  pValue: number | null;
  minRunsPerArm: number;
}): ExperimentState {
  const enough =
    input.treated.runs >= input.minRunsPerArm && input.reference.runs >= input.minRunsPerArm;
  if (!enough) return input.enabled ? "COLLECTING" : "OFF";
  if (input.pValue !== null && input.pValue < SIGNIFICANCE && input.change !== null)
    return input.change < 0 ? "SAVING" : "COSTS_MORE";
  return "NO_DIFFERENCE";
}

export interface PackEntryRef {
  relPath: string;
  role: ContextRole;
}

export interface FileRead {
  relPath: string;
  tokens: number;
}

export interface ReadAudit {
  readFiles: number;
  rereadFiles: number;
  rereadTokens: number;
  missedFiles: number;
  rereadPaths: string[];
}

export function auditReads(
  reads: readonly FileRead[],
  entries: readonly PackEntryRef[],
): ReadAudit {
  const baseline = new Set(
    entries.filter((entry) => BASELINE_ROLES.has(entry.role)).map((entry) => entry.relPath),
  );
  const packed = new Set(entries.map((entry) => entry.relPath));
  const read = new Set<string>();
  const reread = new Set<string>();
  const missed = new Set<string>();
  let rereadTokens = 0;
  for (const entry of reads) {
    read.add(entry.relPath);
    if (baseline.has(entry.relPath)) {
      reread.add(entry.relPath);
      rereadTokens += entry.tokens;
    } else if (!packed.has(entry.relPath)) {
      missed.add(entry.relPath);
    }
  }
  return {
    readFiles: read.size,
    rereadFiles: reread.size,
    rereadTokens,
    missedFiles: missed.size,
    rereadPaths: [...reread].sort().slice(0, MAX_REREAD_PATHS),
  };
}

export function savingRatio(baseline: number, spent: number): number | null {
  return baseline > 0 ? 1 - spent / baseline : null;
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[middle] ?? 0)
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const poly =
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t;
  return sign * (1 - poly * Math.exp(-x * x));
}

export function normalCdf(z: number): number {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

export function mannWhitneyP(a: readonly number[], b: readonly number[]): number | null {
  const n1 = a.length;
  const n2 = b.length;
  if (n1 === 0 || n2 === 0) return null;
  const pooled = [
    ...a.map((value) => ({ value, first: true })),
    ...b.map((value) => ({ value, first: false })),
  ].sort((left, right) => left.value - right.value);
  const total = pooled.length;
  let rankSum = 0;
  let ties = 0;
  for (let start = 0; start < total;) {
    let end = start;
    while (end + 1 < total && pooled[end + 1]?.value === pooled[start]?.value) end += 1;
    const size = end - start + 1;
    const rank = (start + end) / 2 + 1;
    for (let index = start; index <= end; index += 1) {
      if (pooled[index]?.first) rankSum += rank;
    }
    if (size > 1) ties += size ** 3 - size;
    start = end + 1;
  }
  const u = rankSum - (n1 * (n1 + 1)) / 2;
  const mean = (n1 * n2) / 2;
  const variance = ((n1 * n2) / 12) * (total + 1 - ties / (total * (total - 1)));
  if (variance <= 0) return 1;
  const z = Math.max(0, Math.abs(u - mean) - 0.5) / Math.sqrt(variance);
  return z === 0 ? 1 : Math.min(1, 2 * (1 - normalCdf(z)));
}

export interface ArmSample {
  completed: boolean;
  contextTokens: number;
  outputTokens: number;
  costUsd: number | null;
  turns: number | null;
  readFiles: number;
}

function present(values: readonly (number | null)[]): number[] {
  return values.filter((value): value is number => value !== null);
}

export function armStats(arm: ContextArm, samples: readonly ArmSample[]): ArmStats {
  const completed = samples.filter((sample) => sample.completed).length;
  return {
    arm,
    runs: samples.length,
    completed,
    successRate: samples.length > 0 ? completed / samples.length : null,
    medianContextTokens: median(samples.map((sample) => sample.contextTokens)),
    medianOutputTokens: median(samples.map((sample) => sample.outputTokens)),
    medianCostUsd: median(present(samples.map((sample) => sample.costUsd))),
    medianTurns: median(present(samples.map((sample) => sample.turns))),
    medianReadFiles: median(samples.map((sample) => sample.readFiles)),
    totalCostUsd: samples.reduce((sum, sample) => sum + (sample.costUsd ?? 0), 0),
  };
}

export function relativeChange(value: number | null, reference: number | null): number | null {
  return value === null || reference === null || reference <= 0 ? null : value / reference - 1;
}

export function compareArms(input: {
  settings: ContextExperimentSettings;
  pack: readonly ArmSample[];
  control: readonly ArmSample[];
  variant?: readonly ArmSample[];
  windowDays: number;
  since: string | null;
  minRunsPerArm?: number;
}): ExperimentResult {
  const minRunsPerArm = input.minRunsPerArm ?? MIN_RUNS_PER_ARM;
  const pack = armStats("PACK", input.pack);
  const control = armStats("CONTROL", input.control);
  const tokenChange = relativeChange(pack.medianContextTokens, control.medianContextTokens);
  const pValue = mannWhitneyP(
    input.pack.map((sample) => sample.contextTokens),
    input.control.map((sample) => sample.contextTokens),
  );
  const variantSamples = input.variant ?? [];
  const variantArm = input.settings.variant ?? (variantSamples.length > 0 ? "TARGET_L2" : null);
  const variant = variantArm === null ? null : armStats(variantArm, variantSamples);
  const variantTokenChange = variant
    ? relativeChange(variant.medianContextTokens, pack.medianContextTokens)
    : null;
  const variantPValue = variant
    ? mannWhitneyP(
        variantSamples.map((sample) => sample.contextTokens),
        input.pack.map((sample) => sample.contextTokens),
      )
    : null;
  return {
    settings: input.settings,
    state: pairState({
      enabled: input.settings.enabled,
      treated: pack,
      reference: control,
      change: tokenChange,
      pValue,
      minRunsPerArm,
    }),
    windowDays: input.windowDays,
    minRunsPerArm,
    since: input.since,
    pack,
    control,
    tokenChange,
    costChange: relativeChange(pack.medianCostUsd, control.medianCostUsd),
    pValue,
    successGap:
      pack.successRate !== null && control.successRate !== null
        ? pack.successRate - control.successRate
        : null,
    variant,
    variantState: variant
      ? pairState({
          enabled: input.settings.enabled && input.settings.variant !== null,
          treated: variant,
          reference: pack,
          change: variantTokenChange,
          pValue: variantPValue,
          minRunsPerArm,
        })
      : "OFF",
    variantTokenChange,
    variantPValue,
  };
}

function counted(count: number, one: string, many: string): string {
  return tx(count === 1 ? one : many, { count });
}

function sentences(...parts: (string | null)[]): string {
  return parts.filter((part): part is string => part !== null).join(" ");
}

function percent(ratio: number): string {
  return `${Math.round(Math.abs(ratio) * 100)}%`;
}

export function compactTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`;
  return String(Math.round(tokens));
}

function pText(pValue: number | null): string {
  if (pValue === null) return tx("p = n/a");
  return pValue < 0.001 ? "p < 0.001" : `p = ${pValue.toFixed(3)}`;
}

function successNote(experiment: ExperimentResult): string | null {
  const gap = experiment.successGap;
  if (gap === null || gap >= SUCCESS_GAP_WARNING) return null;
  return tx("Careful: {percent} fewer runs succeed with the context.", { percent: percent(gap) });
}

function estimateText(pack: PackAccounting): string {
  if (pack.netSaving === null) return tx("Until then the estimate says no estimate yet.");
  return pack.netSaving > 0
    ? tx("Until then the estimate says an estimated {percent} fewer context tokens.", {
        percent: percent(pack.netSaving),
      })
    : tx("Until then the estimate says no saving even by the estimate.");
}

export function savingsVerdict(experiment: ExperimentResult, pack: PackAccounting): SavingsVerdict {
  const counts = {
    pack: experiment.pack.runs,
    control: experiment.control.runs,
    p: pText(experiment.pValue),
  };
  const medians = tx(
    "Median input tokens per run over {pack} runs with the context and {control} without ({p}).",
    counts,
  );
  switch (experiment.state) {
    case "SAVING":
      return {
        state: "CONFIRMED",
        headline: tx("Measured: runs with the Onyx context use {percent} fewer input tokens", {
          percent: percent(experiment.tokenChange ?? 0),
        }),
        detail: sentences(
          medians,
          experiment.costChange === null
            ? null
            : experiment.costChange <= 0
              ? tx("Median cost per run down {percent}.", {
                  percent: percent(experiment.costChange),
                })
              : tx("Median cost per run up {percent}.", {
                  percent: percent(experiment.costChange),
                }),
          successNote(experiment),
        ),
      };
    case "COSTS_MORE":
      return {
        state: "NOT_PAYING",
        headline: tx("Measured: runs with the Onyx context use {percent} more input tokens", {
          percent: percent(experiment.tokenChange ?? 0),
        }),
        detail: sentences(
          medians,
          tx(
            "The pack is adding tokens instead of saving them: check the re-reads below and the pack budget.",
          ),
          successNote(experiment),
        ),
      };
    case "NO_DIFFERENCE":
      return {
        state: "NO_DIFFERENCE",
        headline: tx("Measured: no significant difference yet"),
        detail: sentences(
          experiment.tokenChange === null
            ? tx(
                "Over {pack} runs with the context and {control} without the median differs by an unknown amount, which could still be chance ({p}).",
                counts,
              )
            : tx(
                "Over {pack} runs with the context and {control} without the median differs by {change}, which could still be chance ({p}).",
                { ...counts, change: percent(experiment.tokenChange) },
              ),
          tx("Keep the experiment running for a clearer answer."),
          successNote(experiment),
        ),
      };
    case "COLLECTING":
      return {
        state: "COLLECTING",
        headline: tx("Measuring: {count} of {needed} runs per arm so far", {
          count: Math.min(experiment.pack.runs, experiment.control.runs),
          needed: experiment.minRunsPerArm,
        }),
        detail: sentences(
          tx(
            "The experiment needs {count} finished runs with and without the context before it can tell.",
            { count: experiment.minRunsPerArm },
          ),
          estimateText(pack),
        ),
      };
    case "OFF":
      if (pack.runsWithPack === 0)
        return {
          state: "NO_DATA",
          headline: tx("No runs with an Onyx context yet"),
          detail: tx(
            "Run a task on an indexed project with target paths to see what the context pack saves.",
          ),
        };
      return {
        state: "ESTIMATE_ONLY",
        headline:
          pack.netSaving !== null && pack.netSaving > 0
            ? tx("Estimated {percent} fewer context tokens, not measured", {
                percent: percent(pack.netSaving),
              })
            : tx("Estimated: the context pack saves nothing"),
        detail: tx(
          "The estimate assumes that without Onyx the agent would read every target and direct dependency in full, and subtracts the files it read again anyway. Turn on the experiment to measure the saving on real runs.",
        ),
      };
  }
}

export function savingsChecks(input: {
  contextEnabled: boolean;
  pack: PackAccounting;
  experiment: ExperimentResult;
}): SavingsCheck[] {
  const { pack, experiment } = input;
  const checks: SavingsCheck[] = [
    input.contextEnabled
      ? {
          id: "context",
          state: "ok",
          title: tx("Onyx context is on"),
          detail: tx("Runs get a context pack, a project map and the onyx MCP tools."),
        }
      : {
          id: "context",
          state: "fail",
          title: tx("Onyx context is off"),
          detail: tx("ONYX_CONTEXT_ENABLED is false: runs get no pack and nothing is saved."),
        },
  ];

  const eligible = pack.runs - pack.controlRuns;
  if (eligible === 0) {
    checks.push({
      id: "coverage",
      state: "idle",
      title: tx("No finished runs yet"),
      detail: tx("Nothing ran in the last {days} days.", { days: pack.windowDays }),
    });
  } else {
    const covered = pack.runsWithPack / eligible >= COVERAGE_WARNING_SHARE;
    const coverage = { count: pack.runsWithPack, total: eligible };
    checks.push({
      id: "coverage",
      state: covered ? "ok" : "warn",
      title: covered
        ? tx("{count} of {total} runs got a context pack", coverage)
        : tx("Only {count} of {total} runs got a context pack", coverage),
      detail: covered
        ? tx(
            "The pack is built from the target paths of the task or the files named in the prompt.",
          )
        : tx(
            "A run gets no pack when the project is not indexed or the task names no files: set target paths or name files in the prompt.",
          ),
    });
  }

  if (pack.runsWithPack === 0 || pack.grossSaving === null || pack.netSaving === null) {
    checks.push({
      id: "rereads",
      state: "idle",
      title: tx("Re-reads not measured yet"),
      detail: tx("They are counted on runs that received a pack."),
    });
  } else {
    const share = pack.baselineTokens > 0 ? pack.rereadTokens / pack.baselineTokens : 0;
    const top = pack.topRereads
      .slice(0, 3)
      .map((file) => file.relPath)
      .join(", ");
    const rereads = {
      runs: pack.runsWithRereads,
      total: pack.runsWithPack,
      count: pack.rereadFiles,
      tokens: compactTokens(pack.rereadTokens),
      share: percent(share),
    };
    const summary =
      pack.rereadFiles === 1
        ? tx(
            "{runs} of {total} runs read again {count} file the pack already covered (~{tokens} tokens, {share} of the full-read baseline).",
            rereads,
          )
        : tx(
            "{runs} of {total} runs read again {count} files the pack already covered (~{tokens} tokens, {share} of the full-read baseline).",
            rereads,
          );
    checks.push(
      share > REREAD_WARNING_SHARE
        ? {
            id: "rereads",
            state: "warn",
            title: tx("The agent re-reads files it already has"),
            detail: sentences(
              summary,
              tx(
                "Claude Code reads a file before editing it, so edited targets are always read again.",
              ),
              top ? tx("Most re-read: {paths}.", { paths: top }) : null,
            ),
          }
        : {
            id: "rereads",
            state: "ok",
            title: tx("Few re-reads"),
            detail: summary,
          },
    );
  }

  const spent = {
    spent: compactTokens(pack.deliveredTokens + pack.rereadTokens),
    baseline: compactTokens(pack.baselineTokens),
  };
  if (pack.netSaving === null) {
    checks.push({
      id: "net",
      state: "idle",
      title: tx("No estimate yet"),
      detail: tx("It appears after the first run with a pack."),
    });
  } else if (pack.netSaving > 0) {
    checks.push({
      id: "net",
      state: "ok",
      title: tx("The pack is smaller than what it replaces"),
      detail: tx(
        "Pack, map, MCP expansions and re-reads add up to {spent} tokens against {baseline} for reading the same files in full.",
        spent,
      ),
    });
  } else {
    checks.push({
      id: "net",
      state: "fail",
      title: tx("The pack costs more than it saves"),
      detail: tx(
        "Pack, map, MCP expansions and re-reads add up to {spent} tokens against {baseline}: lower the pack budget or narrow the target paths.",
        spent,
      ),
    });
  }

  const arms = {
    pack: experiment.pack.runs,
    control: experiment.control.runs,
    p: pText(experiment.pValue),
  };
  const armsWithP = () => tx("{pack} runs with the context and {control} without, {p}.", arms);
  const experimentCheck: Record<ExperimentState, () => SavingsCheck> = {
    OFF: () => ({
      id: "experiment",
      state: "warn",
      title: tx("The saving is not measured"),
      detail: tx(
        "Everything above is an estimate. Turn on the experiment to compare real runs with and without the Onyx context.",
      ),
    }),
    COLLECTING: () => ({
      id: "experiment",
      state: "idle",
      title: tx("The experiment is collecting runs"),
      detail: tx(
        "{pack} runs with the context and {control} without so far; {count} per arm are needed.",
        { ...arms, count: experiment.minRunsPerArm },
      ),
    }),
    SAVING: () => ({
      id: "experiment",
      state: "ok",
      title: tx("The experiment confirms the saving"),
      detail: armsWithP(),
    }),
    NO_DIFFERENCE: () => ({
      id: "experiment",
      state: "warn",
      title: tx("The experiment finds no clear difference"),
      detail: armsWithP(),
    }),
    COSTS_MORE: () => ({
      id: "experiment",
      state: "fail",
      title: tx("The experiment says the context costs more"),
      detail: armsWithP(),
    }),
  };
  checks.push(experimentCheck[experiment.state]());
  return checks;
}

export const CACHE_REWRITE_PREMIUM = 1.25 - 0.1;
export const CACHE_READ_DISCOUNT = 1 - 0.1;
const MEASURED_STATES: ReadonlySet<ExperimentState> = new Set([
  "SAVING",
  "NO_DIFFERENCE",
  "COSTS_MORE",
]);

export interface LedgerInput {
  pack: PackAccounting;
  experiment: ExperimentResult;
  other: OtherSavings;
  reuse: { runs: number; tokens: number };
  prefix: { runs: number; readTokens: number };
  continuations: { current: RunTokens; previous: RunTokens; windowDays: number };
  quota: { deferredRuns: number; limitedRuns: number; windowDays: number };
  memory: { experiment: MemoryExperiment; sessions: number; tokens: number; windowDays: number };
  signatures: { runs: number; tokens: number; windowDays: number };
  concise: ConciseInput;
  exploration: ExplorationInput;
  batching: BatchingInput;
  review: ReviewInput;
  resolution: ResolutionInput;
  insights: InsightsInput;
  ideation: IdeationInput;
}

export interface InsightsInput {
  index: number;
  model: number;
  modelTokens: readonly number[];
  windowDays: number;
}

export interface IdeationInput {
  analyses: number;
  reviews: number;
  snippetTokens: number;
  projectTokens: number;
  modelTokens: number;
  usd: number;
  windowDays: number;
}

export const DEFAULT_MODEL_ANSWER_TOKENS = 8_000;

export interface ReviewInput {
  reviews: number;
  nodes: number;
  caught: number;
  fixed: number;
  tokens: number;
  usd: number;
  windowDays: number;
}

export interface ResolutionInput {
  proposals: number;
  applied: number;
  unusable: number;
  refused: number;
  usd: number;
  windowDays: number;
}

export interface ConciseInput {
  enabled: boolean;
  since: string | null;
  before: readonly number[];
  after: readonly number[];
  windowDays: number;
}

export interface ExplorationInput {
  enabled: boolean;
  withExplorer: readonly number[];
  without: readonly number[];
}

export interface BatchingInput {
  enabled: boolean;
  batched: { runs: number; tokens: number; tasks: number };
  single: { runs: number; tokens: number; tasks: number };
}

export const MIN_BEFORE_AFTER_RUNS = 10;
export const MIN_PLANS = 3;
export const MIN_BATCH_RUNS = 5;

function signedPercent(ratio: number | null): string {
  if (ratio === null) return tx("n/a");
  const value = Math.round(ratio * 100);
  return `${value > 0 ? "+" : ""}${value}%`;
}

export function conciseRow(input: ConciseInput): SavingsLedgerRow {
  const before = median(input.before);
  const after = median(input.after);
  const enough =
    input.since !== null &&
    input.before.length >= MIN_BEFORE_AFTER_RUNS &&
    input.after.length >= MIN_BEFORE_AFTER_RUNS;
  if (enough && before !== null && after !== null)
    return {
      source: "concise-answers",
      evidence: "MEASURED",
      tokens: null,
      usd: null,
      runs: input.after.length,
      detail: tx(
        "Output tokens per completed run: {before} before short summaries, {after} after ({change}, medians over {beforeRuns} and {afterRuns} runs of {days} days each side). Before and after, not an A/B: the tasks differ too.",
        {
          before: compactTokens(before),
          after: compactTokens(after),
          change: signedPercent(relativeChange(after, before)),
          beforeRuns: input.before.length,
          afterRuns: input.after.length,
          days: input.windowDays,
        },
      ),
    };
  return {
    source: "concise-answers",
    evidence: "ESTIMATED",
    tokens: null,
    usd: null,
    runs: input.after.length,
    detail: input.enabled
      ? tx(
          "Expected 20–40% fewer output tokens per run (output costs five times the input). Measured once there are {count} completed runs before and after the switch: now {before} and {after}.",
          { count: MIN_BEFORE_AFTER_RUNS, before: input.before.length, after: input.after.length },
        )
      : tx("Off: final summaries are as long as the agent makes them."),
  };
}

export function explorationRow(input: ExplorationInput): SavingsLedgerRow {
  const withExplorer = median(input.withExplorer);
  const without = median(input.without);
  if (
    input.withExplorer.length >= MIN_PLANS &&
    input.without.length >= MIN_PLANS &&
    withExplorer !== null &&
    without !== null
  )
    return {
      source: "exploration-models",
      evidence: "MEASURED",
      tokens: null,
      usd: null,
      runs: input.withExplorer.length + input.without.length,
      detail: tx(
        "Planner-model cost per plan: {without} without the explorer, {with} with it ({change}, medians over {withoutPlans} and {withPlans} plans). On Claude Max this is the share that weighs on the Opus quota.",
        {
          without: `$${without.toFixed(3)}`,
          with: `$${withExplorer.toFixed(3)}`,
          change: signedPercent(relativeChange(withExplorer, without)),
          withoutPlans: input.without.length,
          withPlans: input.withExplorer.length,
        },
      ),
    };
  return {
    source: "exploration-models",
    evidence: "ESTIMATED",
    tokens: null,
    usd: null,
    runs: input.withExplorer.length,
    detail: input.enabled
      ? tx(
          "The planner and the roadmap delegate searches to an explorer on Haiku and the roadmap runs on Sonnet, so less of the Opus quota goes to reading files. Measured once there are {count} plans with and {count} without it: now {with} and {without}.",
          { count: MIN_PLANS, with: input.withExplorer.length, without: input.without.length },
        )
      : tx("Off: the planner and the roadmap explore on their own model."),
  };
}

export function batchingRow(input: BatchingInput): SavingsLedgerRow {
  const perTask = (group: BatchingInput["batched"]) =>
    group.tasks > 0 ? group.tokens / group.tasks : null;
  const batched = perTask(input.batched);
  const single = perTask(input.single);
  if (
    input.batched.runs >= MIN_BATCH_RUNS &&
    input.single.runs >= MIN_BATCH_RUNS &&
    batched !== null &&
    single !== null
  )
    return {
      source: "small-task-batching",
      evidence: "MEASURED",
      tokens: Math.max(0, Math.round((single - batched) * input.batched.tasks)),
      usd: null,
      runs: input.batched.runs,
      detail: tx(
        "Tokens per completed small task: {single} alone, {batched} in a grouped run ({change}, {batchedTasks} tasks in {batchedRuns} grouped runs against {singleTasks} in {singleRuns} single runs).",
        {
          single: compactTokens(single),
          batched: compactTokens(batched),
          change: signedPercent(relativeChange(batched, single)),
          batchedTasks: input.batched.tasks,
          batchedRuns: input.batched.runs,
          singleTasks: input.single.tasks,
          singleRuns: input.single.runs,
        },
      ),
    };
  return {
    source: "small-task-batching",
    evidence: "ESTIMATED",
    tokens: null,
    usd: null,
    runs: input.batched.runs,
    detail: input.enabled
      ? tx(
          "Expected 10–30% fewer tokens per completed small task. Measured after {count} grouped and {count} single runs of small tasks: now {batched} and {single}.",
          { count: MIN_BATCH_RUNS, batched: input.batched.runs, single: input.single.runs },
        )
      : tx(
          "Off: turn it on in Settings to let Onyx group small queued tasks of the same workspace.",
        ),
  };
}

function dollars(value: number): string {
  return `$${value.toFixed(value >= 1 ? 2 : 3)}`;
}

export function qaReviewRow(input: ReviewInput): SavingsLedgerRow {
  if (input.reviews === 0)
    return {
      source: "qa-review",
      evidence: "ESTIMATED",
      tokens: null,
      usd: null,
      runs: 0,
      detail: tx(
        "No plan used QA in the last {days} days. It is a cost, not a saving: each review reads the diff on the Builder model, an estimated 5–20K tokens per task, to avoid rework after the merge.",
        { days: input.windowDays },
      ),
    };
  return {
    source: "qa-review",
    evidence: "MEASURED",
    tokens: null,
    usd: null,
    runs: input.reviews,
    detail: tx(
      "A cost, not a saving: {reviews} of {tasks} used {tokens} tokens ({usd}) in the last {days} days. They found problems in {caught} before the merge, and the agent fixed {fixed} of them after the review. The rework this avoids after the merge is not measured.",
      {
        reviews: counted(input.reviews, msg("{count} review"), msg("{count} reviews")),
        tasks: counted(input.nodes, msg("{count} task"), msg("{count} tasks")),
        tokens: compactTokens(input.tokens),
        usd: dollars(input.usd),
        days: input.windowDays,
        caught: counted(input.caught, msg("{count} task"), msg("{count} tasks")),
        fixed: input.fixed,
      },
    ),
  };
}

export function conflictResolutionRow(input: ResolutionInput): SavingsLedgerRow {
  if (input.proposals === 0)
    return {
      source: "conflict-resolution",
      evidence: "ESTIMATED",
      tokens: null,
      usd: null,
      runs: 0,
      detail: tx(
        "No merge conflict was handed to Claude in the last {days} days. It costs tokens only when a plan with the option on hits a conflict.",
        { days: input.windowDays },
      ),
    };
  const resolution = {
    count: input.proposals,
    usd: dollars(input.usd),
    days: input.windowDays,
    applied: input.applied,
    refused: input.refused,
    unusable: input.unusable,
  };
  return {
    source: "conflict-resolution",
    evidence: "MEASURED",
    tokens: null,
    usd: null,
    runs: input.proposals,
    detail:
      input.proposals === 1
        ? tx(
            "A cost, not a saving: {count} conflict handed to Claude for {usd} in the last {days} days; {applied} applied, {refused} refused and {unusable} not usable (markers left or tests failing).",
            resolution,
          )
        : tx(
            "A cost, not a saving: {count} conflicts handed to Claude for {usd} in the last {days} days; {applied} applied, {refused} refused and {unusable} not usable (markers left or tests failing).",
            resolution,
          ),
  };
}

export function insightsRow(input: InsightsInput): SavingsLedgerRow {
  const total = input.index + input.model;
  if (total === 0)
    return {
      source: "insights",
      evidence: "ESTIMATED",
      tokens: null,
      usd: null,
      runs: 0,
      detail: tx(
        "No question in the last {days} days. Questions about definitions, usages, imports, central files and cycles are answered from the index at no cost.",
        { days: input.windowDays },
      ),
    };
  const measured = median(input.modelTokens);
  const perAnswer = measured ?? DEFAULT_MODEL_ANSWER_TOKENS;
  const answers = {
    index: input.index,
    count: total,
    percent: `${Math.round((input.index / total) * 100)}%`,
  };
  return {
    source: "insights",
    evidence: "ESTIMATED",
    tokens: Math.round(input.index * perAnswer),
    usd: null,
    runs: total,
    detail: sentences(
      total === 1
        ? tx(
            "{index} of {count} answer came from the index without a model ({percent}, measured).",
            answers,
          )
        : tx(
            "{index} of {count} answers came from the index without a model ({percent}, measured).",
            answers,
          ),
      measured === null
        ? tx("With no model answer yet, each is counted at ~{tokens} tokens (estimate).", {
            tokens: compactTokens(DEFAULT_MODEL_ANSWER_TOKENS),
          })
        : tx(
            "A model answer used a median of {tokens} tokens (measured), so the index answers saved about that much each.",
            { tokens: compactTokens(measured) },
          ),
    ),
  };
}

export function ideationRow(input: IdeationInput): SavingsLedgerRow {
  if (input.reviews === 0)
    return {
      source: "ideation",
      evidence: "ESTIMATED",
      tokens: null,
      usd: null,
      runs: input.analyses,
      detail:
        input.analyses === 0
          ? tx(
              "No analysis in the last {days} days. The static part is free; Claude only reads the suspicious snippets when you ask.",
              { days: input.windowDays },
            )
          : input.analyses === 1
            ? tx(
                "{count} analysis without a model in the last {days} days: rules, dependency audit and import graph cost no tokens.",
                { count: input.analyses, days: input.windowDays },
              )
            : tx(
                "{count} analyses without a model in the last {days} days: rules, dependency audit and import graph cost no tokens.",
                { count: input.analyses, days: input.windowDays },
              ),
    };
  const saved = input.projectTokens - input.snippetTokens;
  const review = {
    count: input.reviews,
    snippets: compactTokens(input.snippetTokens),
    project: compactTokens(input.projectTokens),
    total: compactTokens(input.modelTokens),
    usd: `$${input.usd.toFixed(3)}`,
  };
  const single = input.reviews === 1;
  return {
    source: "ideation",
    evidence: "ESTIMATED",
    tokens: Math.max(0, saved),
    usd: null,
    runs: input.reviews,
    detail:
      saved > 0
        ? single
          ? tx(
              "In {count} review Claude read {snippets} tokens of snippets instead of the {project} tokens of the analysed code (both measured), for {total} tokens in all ({usd}). The saving assumes a review of the whole code would read all of it.",
              review,
            )
          : tx(
              "In {count} reviews Claude read {snippets} tokens of snippets instead of the {project} tokens of the analysed code (both measured), for {total} tokens in all ({usd}). The saving assumes a review of the whole code would read all of it.",
              review,
            )
        : single
          ? tx(
              "In {count} review the snippets ({snippets} tokens) were not smaller than the analysed code ({project} tokens): on a project this small there is nothing to save. Cost {total} tokens ({usd}).",
              review,
            )
          : tx(
              "In {count} reviews the snippets ({snippets} tokens) were not smaller than the analysed code ({project} tokens): on a project this small there is nothing to save. Cost {total} tokens ({usd}).",
              review,
            ),
  };
}

export interface RunTokens {
  runs: number;
  tokens: number;
}

export function stackCommandsRow(input: LedgerInput["continuations"]): SavingsLedgerRow {
  const { current, previous, windowDays } = input;
  if (current.runs === 0 && previous.runs === 0)
    return {
      source: "stack-commands",
      evidence: "ESTIMATED",
      tokens: null,
      usd: null,
      runs: 0,
      detail: tx("No run had to continue after a refused command in the last {days} days.", {
        days: windowDays * 2,
      }),
    };
  const saved = previous.tokens - current.tokens;
  return {
    source: "stack-commands",
    evidence: "ESTIMATED",
    tokens: previous.runs > 0 && saved > 0 ? saved : null,
    usd: null,
    runs: current.runs,
    detail: tx(
      "Runs that continued after a refused command: {current} ({currentTokens} tokens, measured) in the last {days} days, {previous} ({previousTokens}) in the {days} days before. Allowing the stack's commands in advance avoids them; the drop is counted as saved.",
      {
        current: current.runs,
        currentTokens: compactTokens(current.tokens),
        days: windowDays,
        previous: previous.runs,
        previousTokens: compactTokens(previous.tokens),
      },
    ),
  };
}

export function quotaRow(input: LedgerInput["quota"]): SavingsLedgerRow {
  const { deferredRuns, limitedRuns, windowDays } = input;
  return {
    source: "quota",
    evidence: "MEASURED",
    tokens: null,
    usd: null,
    runs: deferredRuns,
    detail:
      deferredRuns === 0 && limitedRuns === 0
        ? tx(
            "No task has waited for the subscription window and no run has hit the limit in the last {days} days.",
            { days: windowDays },
          )
        : tx(
            "In the last {days} days {deferred} waited for the subscription window to reset and {limited} hit the limit while working. Holding moves the spend after the reset instead of reducing it.",
            {
              days: windowDays,
              deferred: counted(deferredRuns, msg("{count} run"), msg("{count} runs")),
              limited: counted(limitedRuns, msg("{count} run"), msg("{count} runs")),
            },
          ),
  };
}

function contextPackRow(pack: PackAccounting, experiment: ExperimentResult): SavingsLedgerRow {
  if (MEASURED_STATES.has(experiment.state) && experiment.tokenChange !== null) {
    return {
      source: "context-pack",
      evidence: "MEASURED",
      tokens: null,
      usd: null,
      runs: experiment.pack.runs + experiment.control.runs,
      detail: tx(
        "A/B experiment: {change} input tokens per run with the Onyx context than without (median over {pack} and {control} runs, p {p}).",
        {
          change: signedPercent(experiment.tokenChange),
          pack: experiment.pack.runs,
          control: experiment.control.runs,
          p: experiment.pValue === null ? tx("n/a") : experiment.pValue.toFixed(3),
        },
      ),
    };
  }
  return {
    source: "context-pack",
    evidence: "ESTIMATED",
    tokens:
      pack.runsWithPack > 0 ? pack.baselineTokens - pack.deliveredTokens - pack.rereadTokens : null,
    usd: null,
    runs: pack.runsWithPack,
    detail: tx(
      "Reading every target and direct dependency in full, minus what Onyx delivered and the files the agent read again anyway. Turn on the experiment to measure it.",
    ),
  };
}

export function signaturesRow(
  experiment: ExperimentResult,
  signatures: LedgerInput["signatures"],
): SavingsLedgerRow {
  const variant = experiment.variant;
  if (
    variant &&
    MEASURED_STATES.has(experiment.variantState) &&
    experiment.variantTokenChange !== null
  ) {
    return {
      source: "target-signatures",
      evidence: "MEASURED",
      tokens: null,
      usd: null,
      runs: variant.runs + experiment.pack.runs,
      detail: tx(
        "A/B against the current pack: {change} input tokens per run when the files to edit arrive as signatures (median over {variant} and {pack} runs, {p}).",
        {
          change: signedPercent(experiment.variantTokenChange),
          variant: variant.runs,
          pack: experiment.pack.runs,
          p: pText(experiment.variantPValue),
        },
      ),
    };
  }
  const delivered = {
    days: signatures.windowDays,
    count: signatures.runs,
    tokens: compactTokens(signatures.tokens),
  };
  return {
    source: "target-signatures",
    evidence: "ESTIMATED",
    tokens: signatures.runs > 0 ? signatures.tokens : null,
    usd: null,
    runs: signatures.runs,
    detail:
      signatures.runs === 0
        ? tx(
            "Not tried yet: choose the variant in the experiment to send the files a task will edit as signatures instead of in full.",
          )
        : signatures.runs === 1
          ? tx(
              "In the last {days} days {count} run of the variant received the files to edit as signatures: {tokens} tokens not sent (counted at delivery). Claude reads a file before editing it anyway; the experiment says whether it explores more.",
              delivered,
            )
          : tx(
              "In the last {days} days {count} runs of the variant received the files to edit as signatures: {tokens} tokens not sent (counted at delivery). Claude reads a file before editing it anyway; the experiment says whether it explores more.",
              delivered,
            ),
  };
}

function memoryCost(input: LedgerInput["memory"]): string {
  const { sessions, tokens, windowDays } = input;
  if (sessions === 0)
    return tx("No new session has started with it in the last {days} days.", { days: windowDays });
  const params = { days: windowDays, count: sessions, tokens: compactTokens(tokens) };
  return sessions === 1
    ? tx(
        "In the last {days} days {count} new session started with it, adding {tokens} tokens in all.",
        params,
      )
    : tx(
        "In the last {days} days {count} new sessions started with it, adding {tokens} tokens in all.",
        params,
      );
}

export function memoryRow(input: LedgerInput["memory"]): SavingsLedgerRow {
  const { experiment, sessions } = input;
  if (MEASURED_STATES.has(experiment.state) && experiment.tokenChange !== null) {
    return {
      source: "project-memory",
      evidence: "MEASURED",
      tokens: null,
      usd: null,
      runs: experiment.withMemory.runs + experiment.without.runs,
      detail: sentences(
        tx(
          "A/B on new sessions: {tokens} input tokens, {files} files read and {turns} turns per run with the project memory than without (medians over {with} and {without} runs, {p}).",
          {
            tokens: signedPercent(experiment.tokenChange),
            files: signedPercent(experiment.readFilesChange),
            turns: signedPercent(experiment.turnsChange),
            with: experiment.withMemory.runs,
            without: experiment.without.runs,
            p: pText(experiment.pValue),
          },
        ),
        memoryCost(input),
      ),
    };
  }
  return {
    source: "project-memory",
    evidence: "ESTIMATED",
    tokens: null,
    usd: null,
    runs: sessions,
    detail: sentences(
      tx(
        "Expected 10–30% fewer files read and turns in new sessions that start with the project memory; not measured yet.",
      ),
      experiment.state === "COLLECTING"
        ? tx(
            "The experiment is collecting runs: {with} with and {without} without, {count} each needed.",
            {
              with: experiment.withMemory.runs,
              without: experiment.without.runs,
              count: experiment.minRunsPerArm,
            },
          )
        : tx("Turn on the memory experiment in Settings to measure it."),
      memoryCost(input),
    ),
  };
}

export function savingsLedger(input: LedgerInput): SavingsLedgerRow[] {
  return [
    contextPackRow(input.pack, input.experiment),
    {
      source: "stable-prefix",
      evidence: "ESTIMATED",
      tokens:
        input.prefix.runs > 0 ? Math.round(input.prefix.readTokens * CACHE_REWRITE_PREMIUM) : null,
      usd: null,
      runs: input.prefix.runs,
      detail:
        input.prefix.runs > 0
          ? tx(
              "Resumed runs whose project map had changed but kept the one their session started with. They read {tokens} tokens from Claude's cache (measured); with a new map Claude would have written them again at 1.25× instead of 0.1×.",
              { tokens: compactTokens(input.prefix.readTokens) },
            )
          : tx(
              "No resumed run has needed it yet: it counts the resumes whose project map changed during the session.",
            ),
    },
    {
      source: "pack-reuse",
      evidence: "ESTIMATED",
      tokens: input.reuse.runs > 0 ? input.reuse.tokens : null,
      usd: null,
      runs: input.reuse.runs,
      detail:
        input.reuse.runs > 0
          ? tx(
              "Context pack entries the conversation already had, unchanged: listed by name instead of being sent again in resumed runs.",
            )
          : tx("No resumed run has reused the pack yet."),
    },
    {
      source: "prompt-cache",
      evidence: "MEASURED",
      tokens: Math.round(input.other.cacheReadTokens * CACHE_READ_DISCOUNT),
      usd: input.other.cacheSavedUsd,
      runs: 0,
      detail: tx(
        "{tokens} tokens Claude read from its cache in the last {days} days instead of at the full input rate.",
        { tokens: compactTokens(input.other.cacheReadTokens), days: input.other.windowDays },
      ),
    },
    {
      source: "routing",
      evidence: "ESTIMATED",
      tokens: null,
      usd: input.other.routingSavedUsd,
      runs: 0,
      detail:
        input.other.routingSavingRatio === null
          ? tx("Appears after the first completed task.")
          : tx(
              "{percent} less than running every completed task on the reference model with the same tokens.",
              { percent: `${Math.round(input.other.routingSavingRatio * 100)}%` },
            ),
    },
    stackCommandsRow(input.continuations),
    quotaRow(input.quota),
    memoryRow(input.memory),
    signaturesRow(input.experiment, input.signatures),
    conciseRow(input.concise),
    explorationRow(input.exploration),
    batchingRow(input.batching),
    qaReviewRow(input.review),
    conflictResolutionRow(input.resolution),
    insightsRow(input.insights),
    ideationRow(input.ideation),
  ];
}
