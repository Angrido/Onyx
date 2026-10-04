import { isAbsolute, relative } from "node:path";
import type {
  ExperimentState,
  MemoryArm,
  MemoryArmStats,
  MemoryExperiment,
  MemoryFactKind,
  RunItem,
} from "@onyx/contracts";
import { MIN_RUNS_PER_ARM, SIGNIFICANCE, mannWhitneyP, median, relativeChange } from "./savings";

export interface FactCandidate {
  kind: MemoryFactKind;
  key: string;
  subject: string;
  detail: string | null;
  path: string | null;
}

export interface StoredFact {
  id: string;
  kind: MemoryFactKind;
  subject: string;
  detail: string | null;
  text: string | null;
  evidence: number;
  status: "CANDIDATE" | "ACTIVE" | "SUGGESTED" | "DISMISSED";
  pinned: boolean;
  lastSeenAt: Date;
}

export interface ComposedMemory {
  text: string;
  tokens: number;
  factIds: string[];
  omitted: number;
}

export const FILE_RUNS_TO_REMEMBER = 3;
export const PITFALL_RUNS_TO_SUGGEST = 2;
const MAX_COMMAND = 160;
const MAX_DETAIL = 120;

const USEFUL =
  /(^|[\s/])(test|tests|vitest|jest|pytest|mocha|playwright|build|lint|typecheck|tsc|check|format|fmt|prettier|eslint|biome|ruff|mypy|clippy|vet|make|gradle|gradlew|mvn|migrate)(\s|$|:)/;
const READ_ONLY =
  /^(cat|ls|ll|tree|grep|rg|find|fd|echo|printf|head|tail|sed|awk|wc|pwd|which|file|stat|less|more|true|env|cd)\b|^git\s+(status|diff|log|show|branch|rev-parse|ls-files|grep|blame)\b/;
const ERROR_LINE =
  /(error|Error|ERROR|ERR!|failed|FAILED|FAIL|Cannot|cannot|not found|No such file|Traceback|panic|exception|Exception)/;

function commandOf(input: unknown): string | null {
  if (typeof input !== "object" || input === null) return null;
  const value = (input as Record<string, unknown>)["command"];
  return typeof value === "string" ? value : null;
}

function pathOf(input: unknown): string | null {
  if (typeof input !== "object" || input === null) return null;
  const value = (input as Record<string, unknown>)["file_path"];
  return typeof value === "string" ? value : null;
}

export function normalizeCommand(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.includes("\n")) return null;
  const withoutCd = trimmed.replace(/^cd\s+\S+\s*&&\s*/, "");
  const single = withoutCd
    .replace(/\s+/g, " ")
    .replace(/\s*\|\s*(tail|head)(\s+-n?\s*\d+|\s+-\d+)?$/, "")
    .replace(/\s*2>&1$/, "");
  if (single.length === 0 || single.length > MAX_COMMAND) return null;
  if (/[`$]|<<|\beval\b/.test(single)) return null;
  if (READ_ONLY.test(single)) return null;
  return USEFUL.test(single) ? single : null;
}

export function cleanLine(text: string): string {
  return Array.from(text)
    .filter((char) => {
      const code = char.charCodeAt(0);
      return code >= 32 && code !== 127;
    })
    .join("")
    .replace(/`/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_DETAIL);
}

export function errorLine(output: string): string | null {
  for (const line of output.split("\n")) {
    if (ERROR_LINE.test(line)) {
      const cleaned = cleanLine(line);
      if (cleaned.length >= 8) return cleaned;
    }
  }
  return null;
}

function errorKey(line: string): string {
  return line
    .replace(/[\w.-]*\/[^\s:'"()]+/g, "<path>")
    .replace(/\d+/g, "N")
    .toLowerCase();
}

export function relativeFile(root: string, file: string): string | null {
  const relPath = isAbsolute(file) ? relative(root, file) : file;
  if (relPath.length === 0 || relPath.startsWith("..") || isAbsolute(relPath)) return null;
  const normalized = relPath.replaceAll("\\", "/");
  if (!/^[\w./@+-]+$/.test(normalized) || normalized.length > MAX_COMMAND) return null;
  if (normalized.split("/").some((part) => part === ".git" || part === "node_modules")) return null;
  return normalized;
}

export function extractFacts(items: readonly RunItem[], root: string): FactCandidate[] {
  const uses = new Map<string, { name: string; input: unknown }>();
  const found = new Map<string, FactCandidate>();
  const add = (candidate: FactCandidate) =>
    found.set(`${candidate.kind}:${candidate.key}`, candidate);
  for (const item of items) {
    if (item.kind === "tool_use" && item.parentToolUseId === null) {
      uses.set(item.toolUseId, { name: item.name, input: item.input });
      if (item.name === "Read") {
        const file = pathOf(item.input);
        const relPath = file ? relativeFile(root, file) : null;
        if (relPath)
          add({ kind: "FILE", key: relPath, subject: relPath, detail: null, path: relPath });
      }
      continue;
    }
    if (item.kind !== "tool_result") continue;
    const use = uses.get(item.toolUseId);
    if (!use || use.name !== "Bash") continue;
    const raw = commandOf(use.input);
    const command = raw ? normalizeCommand(raw) : null;
    if (!command) continue;
    if (!item.isError) {
      add({ kind: "COMMAND", key: command, subject: command, detail: null, path: null });
      continue;
    }
    const line = errorLine(item.content);
    if (line)
      add({
        kind: "PITFALL",
        key: `${command}|${errorKey(line)}`,
        subject: command,
        detail: line,
        path: null,
      });
  }
  const succeeded = new Set(
    [...found.values()].filter((fact) => fact.kind === "COMMAND").map((fact) => fact.key),
  );
  return [...found.values()].filter(
    (fact) => fact.kind !== "PITFALL" || !succeeded.has(fact.subject),
  );
}

export function testFact(command: string): FactCandidate | null {
  const single = command.trim().replace(/\s+/g, " ");
  if (single.length === 0 || single.length > MAX_COMMAND || /[`\n]/.test(single)) return null;
  return { kind: "TEST", key: single, subject: single, detail: null, path: null };
}

export function statusFor(
  kind: MemoryFactKind,
  evidence: number,
): "CANDIDATE" | "ACTIVE" | "SUGGESTED" {
  if (kind === "PITFALL") return evidence >= PITFALL_RUNS_TO_SUGGEST ? "SUGGESTED" : "CANDIDATE";
  if (kind === "FILE") return evidence >= FILE_RUNS_TO_REMEMBER ? "ACTIVE" : "CANDIDATE";
  return "ACTIVE";
}

function day(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function factLine(
  fact: Pick<StoredFact, "kind" | "subject" | "detail" | "text" | "evidence" | "lastSeenAt">,
): string {
  if (fact.text) return fact.text;
  const runs = `${fact.evidence} ${fact.evidence === 1 ? "run" : "runs"}`;
  switch (fact.kind) {
    case "TEST":
      return `Tests pass with \`${fact.subject}\` (TDD loop, ${day(fact.lastSeenAt)})`;
    case "COMMAND":
      return `\`${fact.subject}\` works (${runs}, last ${day(fact.lastSeenAt)})`;
    case "FILE":
      return `\`${fact.subject}\` is read often (${runs})`;
    case "PITFALL":
      return `\`${fact.subject}\` has failed with: "${fact.detail ?? ""}" (${runs})`;
    case "NOTE":
      return fact.subject;
  }
}

const KIND_ORDER: Record<MemoryFactKind, number> = {
  NOTE: 0,
  TEST: 1,
  COMMAND: 2,
  PITFALL: 3,
  FILE: 4,
};

export const MEMORY_HEADER =
  "## Onyx project memory\nFacts collected from earlier runs of this project, each with its source. They can be out of date: check before relying on one.";

export function isExpired(
  fact: Pick<StoredFact, "pinned" | "lastSeenAt" | "kind">,
  expiryDays: number,
  now: Date,
): boolean {
  if (fact.pinned || fact.kind === "NOTE") return false;
  return now.getTime() - fact.lastSeenAt.getTime() > expiryDays * 86_400_000;
}

export function composeMemory(
  facts: readonly StoredFact[],
  options: { budgetTokens: number; expiryDays: number; now: Date; count: (text: string) => number },
): ComposedMemory | null {
  const eligible = facts
    .filter((fact) => fact.status === "ACTIVE" && !isExpired(fact, options.expiryDays, options.now))
    .sort(
      (left, right) =>
        Number(right.pinned) - Number(left.pinned) ||
        KIND_ORDER[left.kind] - KIND_ORDER[right.kind] ||
        right.evidence - left.evidence ||
        right.lastSeenAt.getTime() - left.lastSeenAt.getTime(),
    );
  if (eligible.length === 0) return null;
  const lines: string[] = [];
  const ids: string[] = [];
  let tokens = options.count(MEMORY_HEADER);
  for (const fact of eligible) {
    const line = `- ${factLine(fact)}`;
    const cost = options.count(`\n${line}`);
    if (tokens + cost > options.budgetTokens) continue;
    tokens += cost;
    lines.push(line);
    ids.push(fact.id);
  }
  if (lines.length === 0) return null;
  return {
    text: [MEMORY_HEADER, ...lines].join("\n"),
    tokens,
    factIds: ids,
    omitted: eligible.length - lines.length,
  };
}

export interface MemorySample {
  completed: boolean;
  contextTokens: number;
  readFiles: number;
  turns: number | null;
}

function armOf(arm: MemoryArm, samples: readonly MemorySample[]): MemoryArmStats {
  const completed = samples.filter((sample) => sample.completed).length;
  return {
    arm,
    runs: samples.length,
    completed,
    successRate: samples.length > 0 ? completed / samples.length : null,
    medianContextTokens: median(samples.map((sample) => sample.contextTokens)),
    medianReadFiles: median(samples.map((sample) => sample.readFiles)),
    medianTurns: median(samples.flatMap((sample) => (sample.turns === null ? [] : [sample.turns]))),
  };
}

export function compareMemoryArms(input: {
  enabled: boolean;
  withMemory: readonly MemorySample[];
  without: readonly MemorySample[];
  windowDays: number;
  minRunsPerArm?: number;
}): MemoryExperiment {
  const minRunsPerArm = input.minRunsPerArm ?? MIN_RUNS_PER_ARM;
  const withMemory = armOf("MEMORY", input.withMemory);
  const without = armOf("NO_MEMORY", input.without);
  const tokenChange = relativeChange(withMemory.medianContextTokens, without.medianContextTokens);
  const pValue = mannWhitneyP(
    input.withMemory.map((sample) => sample.contextTokens),
    input.without.map((sample) => sample.contextTokens),
  );
  const enough = withMemory.runs >= minRunsPerArm && without.runs >= minRunsPerArm;
  const state: ExperimentState = !enough
    ? input.enabled
      ? "COLLECTING"
      : "OFF"
    : pValue !== null && pValue < SIGNIFICANCE && tokenChange !== null
      ? tokenChange < 0
        ? "SAVING"
        : "COSTS_MORE"
      : "NO_DIFFERENCE";
  return {
    state,
    windowDays: input.windowDays,
    minRunsPerArm,
    withMemory,
    without,
    tokenChange,
    readFilesChange: relativeChange(withMemory.medianReadFiles, without.medianReadFiles),
    turnsChange: relativeChange(withMemory.medianTurns, without.medianTurns),
    pValue,
    successGap:
      withMemory.successRate !== null && without.successRate !== null
        ? withMemory.successRate - without.successRate
        : null,
  };
}

export function drawMemoryArm(input: {
  enabled: boolean;
  experiment: boolean;
  freshSession: boolean;
  random: () => number;
}): MemoryArm | null {
  if (!input.enabled || !input.experiment || !input.freshSession) return null;
  return input.random() < 0.5 ? "NO_MEMORY" : "MEMORY";
}
