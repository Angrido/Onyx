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

export function ignoredNote(labels: readonly string[]): string {
  if (labels.length === 0) return "";
  const shown = labels.slice(0, 3).join("; ");
  const more = labels.length > 3 ? ` and ${labels.length - 3} more` : "";
  return ` · ignored ${labels.length} failure${labels.length === 1 ? "" : "s"} that already failed before this work: ${shown}${more}`;
}
