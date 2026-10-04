import type { GitSummary, ProjectHealth, RunStatus, TddStatus } from "@onyx/contracts";

export interface HealthInput {
  indexError: string | null;
  git: GitSummary;
  lastRun: { status: RunStatus } | null;
  lastTdd: { status: TddStatus } | null;
  pendingApprovals: number;
}

const RANK: Record<ProjectHealth, number> = { OK: 0, ATTENTION: 1, ERROR: 2 };

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

export function projectHealth(input: HealthInput): { health: ProjectHealth; reasons: string[] } {
  const found: { level: ProjectHealth; reason: string }[] = [];
  if (input.indexError)
    found.push({ level: "ERROR", reason: `The code index failed: ${input.indexError}` });
  if (input.git.error)
    found.push({ level: "ERROR", reason: `Git could not read the project: ${input.git.error}` });
  else if (!input.git.isRepo) found.push({ level: "ATTENTION", reason: "Not a git repository" });
  if (input.lastRun?.status === "FAILED" || input.lastRun?.status === "TIMEOUT")
    found.push({ level: "ATTENTION", reason: "The last run failed" });
  else if (input.lastRun?.status === "INTERRUPTED")
    found.push({ level: "ATTENTION", reason: "The last run was interrupted" });
  if (
    input.lastTdd &&
    (input.lastTdd.status === "EXHAUSTED" ||
      input.lastTdd.status === "STALLED" ||
      input.lastTdd.status === "FAILED")
  )
    found.push({ level: "ATTENTION", reason: "The last TDD loop did not reach green" });
  if (input.pendingApprovals > 0)
    found.push({
      level: "ATTENTION",
      reason: `${plural(input.pendingApprovals, "approval", "approvals")} waiting`,
    });
  if (input.git.behind > 0)
    found.push({
      level: "ATTENTION",
      reason: `${plural(input.git.behind, "commit", "commits")} behind ${input.git.upstream ?? "upstream"}`,
    });
  const health = found.reduce<ProjectHealth>(
    (worst, entry) => (RANK[entry.level] > RANK[worst] ? entry.level : worst),
    "OK",
  );
  return {
    health,
    reasons: [...found]
      .sort((left, right) => RANK[right.level] - RANK[left.level])
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
