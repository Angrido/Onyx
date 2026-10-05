import { interpolate, msg } from "../../i18n";
import { failureId, type TestFailure } from "./report";

export function baselineKey(failure: TestFailure): string {
  if (failure.kind === "test" || failure.kind === "suite")
    return `${failure.kind}::${failureId(failure)}`;
  const firstLine = failure.message.split("\n")[0]?.trim() ?? "";
  return `${failure.kind}::${failure.file}::${failure.errorType}::${firstLine}`;
}

export function baselineLabel(failure: TestFailure): string {
  return failure.kind === "test" ? `${failure.file} › ${failure.name}` : failure.name;
}

export interface BaselineSplit {
  kept: TestFailure[];
  ignored: TestFailure[];
}

export function splitBaseline(
  failures: readonly TestFailure[],
  baseline: ReadonlySet<string>,
  ownFiles: readonly string[],
): BaselineSplit {
  const kept: TestFailure[] = [];
  const ignored: TestFailure[] = [];
  for (const failure of failures) {
    if (baseline.has(baselineKey(failure)) && !ownFiles.includes(failure.file))
      ignored.push(failure);
    else kept.push(failure);
  }
  return { kept, ignored };
}

export const IGNORED_NOTE = {
  one: msg(" · ignored {count} failure that already failed before this work: {labels}"),
  many: msg(" · ignored {count} failures that already failed before this work: {labels}"),
  more: msg("{labels} and {count} more"),
} as const;

export function ignoredNote(labels: readonly string[]): string {
  if (labels.length === 0) return "";
  const shown = labels.slice(0, 3).join("; ");
  return interpolate(labels.length === 1 ? IGNORED_NOTE.one : IGNORED_NOTE.many, {
    count: labels.length,
    labels:
      labels.length > 3
        ? interpolate(IGNORED_NOTE.more, { labels: shown, count: labels.length - 3 })
        : shown,
  });
}
