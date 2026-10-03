import { cacheHitRatio, type TelemetrySummary, type UsageWindow } from "@onyx/contracts";
import type { PrismaClient } from "@onyx/db";

const DAY_MS = 86_400_000;

function startOfDay(reference: Date): Date {
  const start = new Date(reference);
  start.setHours(0, 0, 0, 0);
  return start;
}

export class TelemetryService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly counters: () => { activeRuns: number; queuedTasks: number },
  ) {}

  async summary(now = new Date()): Promise<TelemetrySummary> {
    const weekStart = new Date(now.getTime() - 7 * DAY_MS);
    const [today, last7Days, byModel] = await Promise.all([
      this.window(startOfDay(now)),
      this.window(weekStart),
      this.prisma.tokenLog.groupBy({
        by: ["modelId"],
        where: { scope: "RUN_TOTAL", createdAt: { gte: weekStart } },
        _sum: {
          inputTokens: true,
          outputTokens: true,
          cacheCreationTokens: true,
          cacheReadTokens: true,
          costUsd: true,
        },
        _count: { _all: true },
      }),
    ]);
    return {
      ...this.counters(),
      today,
      last7Days,
      byModel: byModel
        .map((row) => ({
          modelId: row.modelId,
          runs: row._count._all,
          costUsd: row._sum.costUsd ?? 0,
          usage: {
            inputTokens: row._sum.inputTokens ?? 0,
            outputTokens: row._sum.outputTokens ?? 0,
            cacheCreationTokens: row._sum.cacheCreationTokens ?? 0,
            cacheReadTokens: row._sum.cacheReadTokens ?? 0,
          },
        }))
        .sort((left, right) => right.costUsd - left.costUsd),
    };
  }

  private async window(since: Date): Promise<UsageWindow> {
    const aggregate = await this.prisma.tokenLog.aggregate({
      where: { scope: "RUN_TOTAL", createdAt: { gte: since } },
      _sum: {
        inputTokens: true,
        outputTokens: true,
        cacheCreationTokens: true,
        cacheReadTokens: true,
        costUsd: true,
      },
      _count: { _all: true },
    });
    const usage = {
      inputTokens: aggregate._sum.inputTokens ?? 0,
      outputTokens: aggregate._sum.outputTokens ?? 0,
      cacheCreationTokens: aggregate._sum.cacheCreationTokens ?? 0,
      cacheReadTokens: aggregate._sum.cacheReadTokens ?? 0,
    };
    return {
      runs: aggregate._count._all,
      costUsd: aggregate._sum.costUsd ?? 0,
      usage,
      cacheHitRatio: cacheHitRatio(usage),
    };
  }
}
