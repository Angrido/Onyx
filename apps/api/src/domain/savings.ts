import type {
  ArmStats,
  ContextArm,
  ContextExperimentSettings,
  ContextRole,
  ExperimentResult,
  ExperimentState,
  OtherSavings,
  PackAccounting,
  SavingsCheck,
  SavingsLedgerRow,
  SavingsVerdict,
} from "@onyx/contracts";

export const DEFAULT_EXPERIMENT: ContextExperimentSettings = { enabled: false, controlShare: 0.25 };
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
  return input.random() < input.settings.controlShare ? "CONTROL" : "PACK";
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
  const enough = pack.runs >= minRunsPerArm && control.runs >= minRunsPerArm;
  let state: ExperimentState;
  if (!enough) state = input.settings.enabled ? "COLLECTING" : "OFF";
  else if (pValue !== null && pValue < SIGNIFICANCE && tokenChange !== null)
    state = tokenChange < 0 ? "SAVING" : "COSTS_MORE";
  else state = "NO_DIFFERENCE";
  return {
    settings: input.settings,
    state,
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
      detail: `Resumed runs whose project map had changed but kept the one their session started with. They read ${compactTokens(input.prefix.readTokens)} tokens from Claude's cache (measured); with a new map Claude would have written them again at 1.25× instead of 0.1×.`,
    },
    {
      source: "pack-reuse",
      evidence: "ESTIMATED",
      tokens: input.reuse.runs > 0 ? input.reuse.tokens : null,
      usd: null,
      runs: input.reuse.runs,
      detail:
        "Context pack entries the conversation already had, unchanged: listed by name instead of being sent again in resumed runs.",
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
  ];
}
