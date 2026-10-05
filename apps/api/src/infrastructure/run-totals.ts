import { Prisma, type PrismaClient } from "@onyx/db";

export interface RunTotalRow {
  runId: string;
  taskId: string;
  status: string;
  modelId: string;
  costUsd: number | null;
  tier: string | null;
  contextArm: string | null;
  memoryArm: string | null;
  numTurns: number | null;
  ctxReadFiles: number | null;
  startedAt: string;
  logCost: number | null;
  counterfactual: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheCreationTokens: number | null;
  cacheReadTokens: number | null;
}

export function sqlDate(date: Date): string {
  return date.toISOString().replace("Z", "+00:00");
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function textOrNull(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

const COLUMNS = Prisma.sql`
  r.id AS runId, r.taskId AS taskId, r.status AS status, r.modelId AS modelId,
  r.costUsd AS costUsd, d.tier AS tier, r.contextArm AS contextArm, r.memoryArm AS memoryArm, r.numTurns AS numTurns,
  r.ctxReadFiles AS ctxReadFiles, r.startedAt AS startedAt,
  l.costUsd AS logCost, l.counterfactualUsd AS counterfactual,
  l.inputTokens AS inputTokens, l.outputTokens AS outputTokens,
  l.cacheCreationTokens AS cacheCreationTokens, l.cacheReadTokens AS cacheReadTokens`;

const JOINS = Prisma.sql`
  LEFT JOIN RoutingDecision d ON d.id = r.routingDecisionId
  LEFT JOIN TokenLog l ON l.id = (
    SELECT t2.id FROM TokenLog t2 WHERE t2.runId = r.id AND t2.scope = 'RUN_TOTAL' LIMIT 1
  )`;

function toRow(raw: Record<string, unknown>): RunTotalRow {
  return {
    runId: String(raw["runId"]),
    taskId: String(raw["taskId"]),
    status: String(raw["status"]),
    modelId: String(raw["modelId"]),
    costUsd: numberOrNull(raw["costUsd"]),
    tier: textOrNull(raw["tier"]),
    contextArm: textOrNull(raw["contextArm"]),
    memoryArm: textOrNull(raw["memoryArm"]),
    numTurns: numberOrNull(raw["numTurns"]),
    ctxReadFiles: numberOrNull(raw["ctxReadFiles"]),
    startedAt: String(raw["startedAt"]),
    logCost: numberOrNull(raw["logCost"]),
    counterfactual: numberOrNull(raw["counterfactual"]),
    inputTokens: numberOrNull(raw["inputTokens"]),
    outputTokens: numberOrNull(raw["outputTokens"]),
    cacheCreationTokens: numberOrNull(raw["cacheCreationTokens"]),
    cacheReadTokens: numberOrNull(raw["cacheReadTokens"]),
  };
}

export async function completedTaskRuns(
  prisma: PrismaClient,
  since: Date,
  projectId: string | null,
): Promise<RunTotalRow[]> {
  const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
    SELECT ${COLUMNS}
    FROM Task t
    JOIN AgentRun r ON r.taskId = t.id
    ${JOINS}
    WHERE t.status = 'COMPLETED' AND t.completedAt >= ${sqlDate(since)}
    ${projectId === null ? Prisma.empty : Prisma.sql`AND t.projectId = ${projectId}`}
    ORDER BY r.taskId, r.startedAt`;
  return rows.map(toRow);
}

export async function experimentRuns(
  prisma: PrismaClient,
  since: Date,
  statuses: readonly string[],
  arm: "contextArm" | "memoryArm" = "contextArm",
): Promise<RunTotalRow[]> {
  const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
    SELECT ${COLUMNS}
    FROM AgentRun r
    ${JOINS}
    WHERE ${Prisma.raw(arm === "memoryArm" ? "r.memoryArm" : "r.contextArm")} IS NOT NULL AND r.startedAt >= ${sqlDate(since)}
      AND r.status IN (${Prisma.join([...statuses])})
    ORDER BY r.startedAt`;
  return rows.map(toRow);
}
