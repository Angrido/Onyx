import type { GitSummary, ProjectHealth, RunStatus, TddStatus } from "@onyx/contracts";
import { tx } from "../i18n";

export interface HealthInput {
  indexError: string | null;
  git: GitSummary;
  lastRun: { status: RunStatus } | null;
  lastTdd: { status: TddStatus } | null;
  pendingApprovals: number;
}

const RANK: Record<ProjectHealth, number> = { OK: 0, ATTENTION: 1, ERROR: 2 };

export function projectHealth(input: HealthInput): { health: ProjectHealth; reasons: string[] } {
  const found: { level: ProjectHealth; reason: string }[] = [];
  if (input.indexError)
    found.push({
      level: "ERROR",
      reason: tx("The code index failed: {error}", { error: input.indexError }),
    });
  if (input.git.error)
    found.push({
      level: "ERROR",
      reason: tx("Git could not read the project: {error}", { error: input.git.error }),
    });
  else if (!input.git.isRepo)
    found.push({ level: "ATTENTION", reason: tx("Not a git repository") });
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
  const behind = { count: input.git.behind, upstream: input.git.upstream ?? "upstream" };
  if (input.git.behind > 0)
    found.push({
      level: "ATTENTION",
      reason:
        input.git.behind === 1
          ? tx("{count} commit behind {upstream}", behind)
          : tx("{count} commits behind {upstream}", behind),
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
