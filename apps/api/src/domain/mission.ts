import type { GitSummary, ProjectHealth, RunStatus, TddStatus } from "@onyx/contracts";
import { tx } from "../i18n";
import { HEALTH_RANK, gitCheck, indexCheck, type HealthFinding } from "./health";

export interface HealthInput {
  indexError: string | null;
  git: GitSummary;
  lastRun: { status: RunStatus } | null;
  lastTdd: { status: TddStatus } | null;
  pendingApprovals: number;
  checks?: readonly HealthFinding[];
}

export function baseFindings(indexError: string | null, git: GitSummary): HealthFinding[] {
  return [
    ...(indexError
      ? [indexCheck({ state: "failed", error: indexError, indexedAt: null }, new Date())]
      : []),
    gitCheck(git),
  ];
}

export function projectHealth(input: HealthInput): { health: ProjectHealth; reasons: string[] } {
  const found: { level: ProjectHealth; reason: string }[] = [];
  if (input.lastRun?.status === "FAILED" || input.lastRun?.status === "TIMEOUT")
    found.push({ level: "ATTENTION", reason: tx("The last run failed") });
  else if (input.lastRun?.status === "INTERRUPTED")
    found.push({ level: "ATTENTION", reason: tx("The last run was interrupted") });
  if (
    input.lastTdd &&
    (input.lastTdd.status === "EXHAUSTED" ||
      input.lastTdd.status === "STALLED" ||
      input.lastTdd.status === "FAILED")
  )
    found.push({ level: "ATTENTION", reason: tx("The last TDD loop did not reach green") });
  if (input.pendingApprovals > 0)
    found.push({
      level: "ATTENTION",
      reason:
        input.pendingApprovals === 1
          ? tx("{count} approval waiting", { count: input.pendingApprovals })
          : tx("{count} approvals waiting", { count: input.pendingApprovals }),
    });
  for (const check of input.checks ?? baseFindings(input.indexError, input.git))
    if (check.level !== "OK")
      found.push({ level: check.level, reason: tx(check.message, check.params) });
  const health = found.reduce<ProjectHealth>(
    (worst, entry) => (HEALTH_RANK[entry.level] > HEALTH_RANK[worst] ? entry.level : worst),
    "OK",
  );
  return {
    health,
    reasons: [...found]
      .sort((left, right) => HEALTH_RANK[right.level] - HEALTH_RANK[left.level])
      .map((entry) => entry.reason),
  };
}

export async function mapLimited<T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await task(items[index] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
