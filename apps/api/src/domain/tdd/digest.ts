import { createHash } from "node:crypto";
import type { SourceLocation, TestFailure } from "./report";

export const DIGEST_BUDGET_TOKENS = 4_000;
export const SNIPPET_RADIUS = 3;
const MIN_ENTRY_TOKENS = 200;

export interface DigestInput {
  failures: readonly TestFailure[];
  summary: string;
  sources: ReadonlyMap<string, string>;
  budgetTokens: number;
  estimate: (text: string) => number;
  regressions?: readonly string[];
}

export interface Digest {
  text: string;
  tokens: number;
  shown: number;
  omitted: number;
  signature: string | null;
}

interface Entry {
  failure: TestFailure;
  duplicates: string[];
}

export function failureSignature(failures: readonly TestFailure[]): string | null {
  if (failures.length === 0) return null;
  const keys = [
    ...new Set(failures.map((failure) => `${failure.file}\n${failure.name}\n${failure.errorType}`)),
  ].sort();
  return createHash("sha256").update(keys.join("\n\n")).digest("hex");
}

export function snippet(
  source: string | undefined,
  location: SourceLocation,
  radius = SNIPPET_RADIUS,
): string | null {
  if (source === undefined) return null;
  const lines = source.split(/\r?\n/);
  if (location.line < 1 || location.line > lines.length) return null;
  const first = Math.max(1, location.line - radius);
  const last = Math.min(lines.length, location.line + radius);
  const width = String(last).length;
  const output: string[] = [];
  for (let number = first; number <= last; number += 1) {
    const marker = number === location.line ? ">" : " ";
    output.push(`${marker} ${String(number).padStart(width)} | ${lines[number - 1] ?? ""}`);
  }
  return output.join("\n");
}

function prioritise(failures: readonly TestFailure[]): Entry[] {
  const byMessage = new Map<string, Entry>();
  const entries: Entry[] = [];
  for (const failure of failures) {
    const key = `${failure.kind}\n${failure.errorType}\n${failure.message}`;
    const existing = byMessage.get(key);
    if (existing && failure.kind !== "typecheck" && failure.kind !== "lint") {
      existing.duplicates.push(failure.name);
      continue;
    }
    const entry = { failure, duplicates: [] };
    byMessage.set(key, entry);
    entries.push(entry);
  }
  const seenFiles = new Set<string>();
  const firsts: Entry[] = [];
  const rest: Entry[] = [];
  for (const entry of entries) {
    if (seenFiles.has(entry.failure.file)) {
      rest.push(entry);
    } else {
      seenFiles.add(entry.failure.file);
      firsts.push(entry);
    }
  }
  return [...firsts, ...rest];
}

function heading(index: number, failure: TestFailure): string {
  if (failure.kind === "test") return `### ${index}. ${failure.file} › ${failure.name}`;
  if (failure.kind === "suite") return `### ${index}. ${failure.file} failed to run`;
  if (failure.kind === "run") return `### ${index}. ${failure.name} (${failure.errorType})`;
  return `### ${index}. ${failure.name}`;
}

function frameLine(frame: TestFailure["frames"][number]): string {
  const where = `${frame.file}:${frame.line}:${frame.column}`;
  return frame.fn ? `  at ${frame.fn} (${where})` : `  at ${where}`;
}

function renderEntry(
  index: number,
  entry: Entry,
  sources: ReadonlyMap<string, string>,
  compact: boolean,
): string {
  const { failure } = entry;
  const parts = [heading(index, failure)];
  const message = compact ? (failure.message.split("\n")[0] ?? "") : failure.message;
  parts.push(
    failure.kind === "typecheck" || failure.kind === "lint" ? message : "```\n" + message + "\n```",
  );
  const frames = failure.kind === "typecheck" || failure.kind === "lint" ? [] : failure.frames;
  if (frames.length > 0) parts.push(frames.map(frameLine).join("\n"));
  if (!compact && failure.location) {
    const code = snippet(sources.get(failure.location.file), failure.location);
    if (code)
      parts.push(`${failure.location.file}:${failure.location.line}\n\`\`\`\n${code}\n\`\`\``);
  }
  if (entry.duplicates.length > 0) {
    const names = entry.duplicates.slice(0, 5).join("; ");
    const more = entry.duplicates.length > 5 ? ` and ${entry.duplicates.length - 5} more` : "";
    parts.push(`Same error in: ${names}${more}`);
  }
  return parts.join("\n");
}

export function buildDigest(input: DigestInput): Digest {
  const signature = failureSignature(input.failures);
  const header: string[] = [input.summary];
  if (input.regressions && input.regressions.length > 0) {
    header.push(
      `Regressions: ${input.regressions.length} test(s) passed before your last change and fail now: ${input.regressions.slice(0, 8).join("; ")}${input.regressions.length > 8 ? " …" : ""}`,
    );
  }
  const entries = prioritise(input.failures);
  const blocks: string[] = [];
  let used = input.estimate(header.join("\n"));
  let shownFailures = 0;
  for (const [position, entry] of entries.entries()) {
    const full = renderEntry(position + 1, entry, input.sources, false);
    const fullTokens = input.estimate(full);
    const remaining = input.budgetTokens - used;
    let block: string | null = null;
    if (fullTokens <= remaining || blocks.length === 0) {
      block =
        fullTokens <= remaining ? full : renderEntry(position + 1, entry, input.sources, true);
    } else if (remaining >= MIN_ENTRY_TOKENS) {
      const compact = renderEntry(position + 1, entry, input.sources, true);
      if (input.estimate(compact) <= remaining) block = compact;
    }
    if (block === null) break;
    blocks.push(block);
    used += input.estimate(block) + 1;
    shownFailures += 1 + entry.duplicates.length;
  }
  const omittedEntries = entries.slice(blocks.length);
  const omitted = omittedEntries.reduce((sum, entry) => sum + 1 + entry.duplicates.length, 0);
  if (omitted > 0) {
    const files = [...new Set(omittedEntries.map((entry) => entry.failure.file))];
    blocks.push(
      `Omitted to stay within ${input.budgetTokens} tokens: ${omitted} more failure(s) in ${files.length} file(s): ${files.slice(0, 10).join(", ")}${files.length > 10 ? " …" : ""}. Fix the ones above first.`,
    );
  }
  const text = [...header, "", ...blocks.flatMap((block) => [block, ""])].join("\n").trim();
  return { text, tokens: input.estimate(text), shown: shownFailures, omitted, signature };
}
