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

function plural(count: number, noun: string): string {
  return `${count} ${count === 1 ? noun : `${noun}s`}`;
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
  if (pValue === null) return "p = n/a";
  return pValue < 0.001 ? "p < 0.001" : `p = ${pValue.toFixed(3)}`;
}

function successNote(experiment: ExperimentResult): string {
  const gap = experiment.successGap;
  if (gap === null || gap >= SUCCESS_GAP_WARNING) return "";
  return ` Careful: ${percent(gap)} fewer runs succeed with the context.`;
}

function estimateText(pack: PackAccounting): string {
  if (pack.netSaving === null) return "no estimate yet";
  return pack.netSaving > 0
    ? `an estimated ${percent(pack.netSaving)} fewer context tokens`
    : "no saving even by the estimate";
}

export function savingsVerdict(experiment: ExperimentResult, pack: PackAccounting): SavingsVerdict {
  const counts = `${experiment.pack.runs} runs with the context and ${experiment.control.runs} without`;
  switch (experiment.state) {
    case "SAVING":
      return {
        state: "CONFIRMED",
        headline: `Measured: runs with the Onyx context use ${percent(experiment.tokenChange ?? 0)} fewer input tokens`,
        detail: `Median input tokens per run over ${counts} (${pText(experiment.pValue)}).${experiment.costChange !== null ? ` Median cost per run ${experiment.costChange <= 0 ? "down" : "up"} ${percent(experiment.costChange)}.` : ""}${successNote(experiment)}`,
      };
    case "COSTS_MORE":
      return {
        state: "NOT_PAYING",
        headline: `Measured: runs with the Onyx context use ${percent(experiment.tokenChange ?? 0)} more input tokens`,
        detail: `Median input tokens per run over ${counts} (${pText(experiment.pValue)}). The pack is adding tokens instead of saving them: check the re-reads below and the pack budget.${successNote(experiment)}`,
      };
    case "NO_DIFFERENCE":
      return {
        state: "NO_DIFFERENCE",
        headline: "Measured: no significant difference yet",
        detail: `Over ${counts} the median differs by ${experiment.tokenChange === null ? "an unknown amount" : percent(experiment.tokenChange)}, which could still be chance (${pText(experiment.pValue)}). Keep the experiment running for a clearer answer.${successNote(experiment)}`,
      };
    case "COLLECTING":
      return {
        state: "COLLECTING",
        headline: `Measuring: ${Math.min(experiment.pack.runs, experiment.control.runs)} of ${experiment.minRunsPerArm} runs per arm so far`,
        detail: `The experiment needs ${experiment.minRunsPerArm} finished runs with and without the context before it can tell. Until then the estimate says ${estimateText(pack)}.`,
      };
    case "OFF":
      if (pack.runsWithPack === 0)
        return {
          state: "NO_DATA",
          headline: "No runs with an Onyx context yet",
          detail:
            "Run a task on an indexed project with target paths to see what the context pack saves.",
        };
      return {
        state: "ESTIMATE_ONLY",
        headline:
          pack.netSaving !== null && pack.netSaving > 0
            ? `Estimated ${percent(pack.netSaving)} fewer context tokens, not measured`
            : "Estimated: the context pack saves nothing",
        detail:
          "The estimate assumes that without Onyx the agent would read every target and direct dependency in full, and subtracts the files it read again anyway. Turn on the experiment to measure the saving on real runs.",
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
          title: "Onyx context is on",
          detail: "Runs get a context pack, a project map and the onyx MCP tools.",
        }
      : {
          id: "context",
          state: "fail",
          title: "Onyx context is off",
          detail: "ONYX_CONTEXT_ENABLED is false: runs get no pack and nothing is saved.",
        },
  ];

  const eligible = pack.runs - pack.controlRuns;
  if (eligible === 0) {
    checks.push({
      id: "coverage",
      state: "idle",
      title: "No finished runs yet",
      detail: `Nothing ran in the last ${pack.windowDays} days.`,
    });
  } else {
    const covered = pack.runsWithPack / eligible >= COVERAGE_WARNING_SHARE;
    checks.push({
      id: "coverage",
      state: covered ? "ok" : "warn",
      title: covered
        ? `${pack.runsWithPack} of ${eligible} runs got a context pack`
        : `Only ${pack.runsWithPack} of ${eligible} runs got a context pack`,
      detail: covered
        ? "The pack is built from the target paths of the task or the files named in the prompt."
        : "A run gets no pack when the project is not indexed or the task names no files: set target paths or name files in the prompt.",
    });
  }

  if (pack.runsWithPack === 0 || pack.grossSaving === null || pack.netSaving === null) {
    checks.push({
      id: "rereads",
      state: "idle",
      title: "Re-reads not measured yet",
      detail: "They are counted on runs that received a pack.",
    });
  } else {
    const share = pack.baselineTokens > 0 ? pack.rereadTokens / pack.baselineTokens : 0;
    const top = pack.topRereads
      .slice(0, 3)
      .map((file) => file.relPath)
      .join(", ");
    const summary = `${pack.runsWithRereads} of ${pack.runsWithPack} runs read again ${plural(pack.rereadFiles, "file")} the pack already covered (~${compactTokens(pack.rereadTokens)} tokens, ${percent(share)} of the full-read baseline)`;
    checks.push(
      share > REREAD_WARNING_SHARE
        ? {
            id: "rereads",
            state: "warn",
            title: "The agent re-reads files it already has",
            detail: `${summary}. Claude Code reads a file before editing it, so edited targets are always read again.${top ? ` Most re-read: ${top}.` : ""}`,
          }
        : {
            id: "rereads",
            state: "ok",
            title: "Few re-reads",
            detail: `${summary}.`,
          },
    );
  }

  if (pack.netSaving === null) {
    checks.push({
      id: "net",
      state: "idle",
      title: "No estimate yet",
      detail: "It appears after the first run with a pack.",
    });
  } else if (pack.netSaving > 0) {
    checks.push({
      id: "net",
      state: "ok",
      title: "The pack is smaller than what it replaces",
      detail: `Pack, map, MCP expansions and re-reads add up to ${compactTokens(pack.deliveredTokens + pack.rereadTokens)} tokens against ${compactTokens(pack.baselineTokens)} for reading the same files in full.`,
    });
  } else {
    checks.push({
      id: "net",
      state: "fail",
      title: "The pack costs more than it saves",
      detail: `Pack, map, MCP expansions and re-reads add up to ${compactTokens(pack.deliveredTokens + pack.rereadTokens)} tokens against ${compactTokens(pack.baselineTokens)}: lower the pack budget or narrow the target paths.`,
    });
  }

  const arms = `${experiment.pack.runs} runs with the context and ${experiment.control.runs} without`;
  const experimentCheck: Record<ExperimentState, SavingsCheck> = {
    OFF: {
      id: "experiment",
      state: "warn",
      title: "The saving is not measured",
      detail:
        "Everything above is an estimate. Turn on the experiment to compare real runs with and without the Onyx context.",
    },
    COLLECTING: {
      id: "experiment",
      state: "idle",
      title: "The experiment is collecting runs",
      detail: `${arms} so far; ${experiment.minRunsPerArm} per arm are needed.`,
    },
    SAVING: {
      id: "experiment",
      state: "ok",
      title: "The experiment confirms the saving",
      detail: `${arms}, ${pText(experiment.pValue)}.`,
    },
    NO_DIFFERENCE: {
      id: "experiment",
      state: "warn",
      title: "The experiment finds no clear difference",
      detail: `${arms}, ${pText(experiment.pValue)}.`,
    },
    COSTS_MORE: {
      id: "experiment",
      state: "fail",
      title: "The experiment says the context costs more",
      detail: `${arms}, ${pText(experiment.pValue)}.`,
    },
  };
  checks.push(experimentCheck[experiment.state]);
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
  if (ratio === null) return "n/a";
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
      detail: `Output tokens per completed run: ${compactTokens(before)} before short summaries, ${compactTokens(after)} after (${signedPercent(relativeChange(after, before))}, medians over ${input.before.length} and ${input.after.length} runs of ${input.windowDays} days each side). Before and after, not an A/B: the tasks differ too.`,
    };
  return {
    source: "concise-answers",
    evidence: "ESTIMATED",
    tokens: null,
    usd: null,
    runs: input.after.length,
    detail: input.enabled
      ? `Expected 20–40% fewer output tokens per run (output costs five times the input). Measured once there are ${MIN_BEFORE_AFTER_RUNS} completed runs before and after the switch: now ${input.before.length} and ${input.after.length}.`
      : "Off: final summaries are as long as the agent makes them.",
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
      detail: `Planner-model cost per plan: $${without.toFixed(3)} without the explorer, $${withExplorer.toFixed(3)} with it (${signedPercent(relativeChange(withExplorer, without))}, medians over ${input.without.length} and ${input.withExplorer.length} plans). On Claude Max this is the share that weighs on the Opus quota.`,
    };
  return {
    source: "exploration-models",
    evidence: "ESTIMATED",
    tokens: null,
    usd: null,
    runs: input.withExplorer.length,
    detail: input.enabled
      ? `The planner and the roadmap delegate searches to an explorer on Haiku and the roadmap runs on Sonnet, so less of the Opus quota goes to reading files. Measured once there are ${MIN_PLANS} plans with and ${MIN_PLANS} without it: now ${input.withExplorer.length} and ${input.without.length}.`
      : "Off: the planner and the roadmap explore on their own model.",
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
      detail: `Tokens per completed small task: ${compactTokens(single)} alone, ${compactTokens(batched)} in a grouped run (${signedPercent(relativeChange(batched, single))}, ${input.batched.tasks} tasks in ${input.batched.runs} grouped runs against ${input.single.tasks} in ${input.single.runs} single runs).`,
    };
  return {
    source: "small-task-batching",
    evidence: "ESTIMATED",
    tokens: null,
    usd: null,
    runs: input.batched.runs,
    detail: input.enabled
      ? `Expected 10–30% fewer tokens per completed small task. Measured after ${MIN_BATCH_RUNS} grouped and ${MIN_BATCH_RUNS} single runs of small tasks: now ${input.batched.runs} and ${input.single.runs}.`
      : "Off: turn it on in Settings to let Onyx group small queued tasks of the same workspace.",
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
      detail: `No run had to continue after a refused command in the last ${windowDays * 2} days.`,
    };
  const saved = previous.tokens - current.tokens;
  return {
    source: "stack-commands",
    evidence: "ESTIMATED",
    tokens: previous.runs > 0 && saved > 0 ? saved : null,
    usd: null,
    runs: current.runs,
    detail: `Runs that continued after a refused command: ${current.runs} (${compactTokens(current.tokens)} tokens, measured) in the last ${windowDays} days, ${previous.runs} (${compactTokens(previous.tokens)}) in the ${windowDays} days before. Allowing the stack's commands in advance avoids them; the drop is counted as saved.`,
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
        ? `No task has waited for the subscription window and no run has hit the limit in the last ${windowDays} days.`
        : `In the last ${windowDays} days ${deferredRuns} ${deferredRuns === 1 ? "run" : "runs"} waited for the subscription window to reset and ${limitedRuns} ${limitedRuns === 1 ? "run" : "runs"} hit the limit while working. Holding moves the spend after the reset instead of reducing it.`,
  };
}

function contextPackRow(pack: PackAccounting, experiment: ExperimentResult): SavingsLedgerRow {
  if (MEASURED_STATES.has(experiment.state) && experiment.tokenChange !== null) {
    const change = Math.round(experiment.tokenChange * 100);
    return {
      source: "context-pack",
      evidence: "MEASURED",
      tokens: null,
      usd: null,
      runs: experiment.pack.runs + experiment.control.runs,
      detail: `A/B experiment: ${change > 0 ? "+" : ""}${change}% input tokens per run with the Onyx context than without (median over ${experiment.pack.runs} and ${experiment.control.runs} runs, p ${experiment.pValue === null ? "n/a" : experiment.pValue.toFixed(3)}).`,
    };
  }
  return {
    source: "context-pack",
    evidence: "ESTIMATED",
    tokens:
      pack.runsWithPack > 0 ? pack.baselineTokens - pack.deliveredTokens - pack.rereadTokens : null,
    usd: null,
    runs: pack.runsWithPack,
    detail:
      "Reading every target and direct dependency in full, minus what Onyx delivered and the files the agent read again anyway. Turn on the experiment to measure it.",
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
    const change = Math.round(experiment.variantTokenChange * 100);
    return {
      source: "target-signatures",
      evidence: "MEASURED",
      tokens: null,
      usd: null,
      runs: variant.runs + experiment.pack.runs,
      detail: `A/B against the current pack: ${change > 0 ? "+" : ""}${change}% input tokens per run when the files to edit arrive as signatures (median over ${variant.runs} and ${experiment.pack.runs} runs, ${pText(experiment.variantPValue)}).`,
    };
  }
  return {
    source: "target-signatures",
    evidence: "ESTIMATED",
    tokens: signatures.runs > 0 ? signatures.tokens : null,
    usd: null,
    runs: signatures.runs,
    detail:
      signatures.runs > 0
        ? `In the last ${signatures.windowDays} days ${plural(signatures.runs, "run")} of the variant received the files to edit as signatures: ${compactTokens(signatures.tokens)} tokens not sent (counted at delivery). Claude reads a file before editing it anyway; the experiment says whether it explores more.`
        : "Not tried yet: choose the variant in the experiment to send the files a task will edit as signatures instead of in full.",
  };
}

export function memoryRow(input: LedgerInput["memory"]): SavingsLedgerRow {
  const { experiment, sessions, tokens, windowDays } = input;
  const cost =
    sessions > 0
      ? ` In the last ${windowDays} days ${plural(sessions, "new session")} started with it, adding ${compactTokens(tokens)} tokens in all.`
      : ` No new session has started with it in the last ${windowDays} days.`;
  if (MEASURED_STATES.has(experiment.state) && experiment.tokenChange !== null) {
    const signed = (ratio: number | null) =>
      ratio === null ? "n/a" : `${ratio > 0 ? "+" : ""}${Math.round(ratio * 100)}%`;
    return {
      source: "project-memory",
      evidence: "MEASURED",
      tokens: null,
      usd: null,
      runs: experiment.withMemory.runs + experiment.without.runs,
      detail: `A/B on new sessions: ${signed(experiment.tokenChange)} input tokens, ${signed(experiment.readFilesChange)} files read and ${signed(experiment.turnsChange)} turns per run with the project memory than without (medians over ${experiment.withMemory.runs} and ${experiment.without.runs} runs, ${pText(experiment.pValue)}).${cost}`,
    };
  }
  return {
    source: "project-memory",
    evidence: "ESTIMATED",
    tokens: null,
    usd: null,
    runs: sessions,
    detail: `Expected 10–30% fewer files read and turns in new sessions that start with the project memory; not measured yet. ${
      experiment.state === "COLLECTING"
        ? `The experiment is collecting runs: ${experiment.withMemory.runs} with and ${experiment.without.runs} without, ${experiment.minRunsPerArm} each needed.`
        : "Turn on the memory experiment in Settings to measure it."
    }${cost}`,
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
          ? `Resumed runs whose project map had changed but kept the one their session started with. They read ${compactTokens(input.prefix.readTokens)} tokens from Claude's cache (measured); with a new map Claude would have written them again at 1.25× instead of 0.1×.`
          : "No resumed run has needed it yet: it counts the resumes whose project map changed during the session.",
    },
    {
      source: "pack-reuse",
      evidence: "ESTIMATED",
      tokens: input.reuse.runs > 0 ? input.reuse.tokens : null,
      usd: null,
      runs: input.reuse.runs,
      detail:
        input.reuse.runs > 0
          ? "Context pack entries the conversation already had, unchanged: listed by name instead of being sent again in resumed runs."
          : "No resumed run has reused the pack yet.",
    },
    {
      source: "prompt-cache",
      evidence: "MEASURED",
      tokens: Math.round(input.other.cacheReadTokens * CACHE_READ_DISCOUNT),
      usd: input.other.cacheSavedUsd,
      runs: 0,
      detail: `${compactTokens(input.other.cacheReadTokens)} tokens Claude read from its cache in the last ${input.other.windowDays} days instead of at the full input rate.`,
    },
    {
      source: "routing",
      evidence: "ESTIMATED",
      tokens: null,
      usd: input.other.routingSavedUsd,
      runs: 0,
      detail:
        input.other.routingSavingRatio === null
          ? "Appears after the first completed task."
          : `${Math.round(input.other.routingSavingRatio * 100)}% less than running every completed task on the reference model with the same tokens.`,
    },
    stackCommandsRow(input.continuations),
    quotaRow(input.quota),
    memoryRow(input.memory),
    signaturesRow(input.experiment, input.signatures),
    conciseRow(input.concise),
    explorationRow(input.exploration),
    batchingRow(input.batching),
  ];
}
