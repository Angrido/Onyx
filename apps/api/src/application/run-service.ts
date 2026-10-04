import {
  normalizeStoredEvent,
  type RunItem,
  type BlockedCommandsResponse,
  type RunDto,
  type RunEventsResponse,
} from "@onyx/contracts";
import type { PrismaClient } from "@onyx/db";
import { conflict, notFound } from "../errors";
import type { StoredRunEvent } from "../infrastructure/ws-hub";
import { analyzeCommands } from "../domain/command-rules";
import { RUN_INCLUDE, toRunDto, toStringArray } from "./mappers";
import type { RunScheduler } from "./run-scheduler";

function toStoredEvent(row: {
  seq: number;
  type: string;
  payload: unknown;
  items: unknown;
  createdAt: Date;
}): StoredRunEvent {
  return {
    seq: row.seq,
    ts: row.createdAt.toISOString(),
    items: Array.isArray(row.items)
      ? (row.items as RunItem[])
      : normalizeStoredEvent(row.type, row.payload),
  };
}

export class RunService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly scheduler: RunScheduler,
    private readonly grantedRules: (
      projectId: string,
      target: { taskId: string; agentConfigId: string | null },
    ) => Promise<string[]> = () => Promise.resolve([]),
  ) {}

  async get(id: string): Promise<RunDto> {
    const run = await this.prisma.agentRun.findUnique({ where: { id }, include: RUN_INCLUDE });
    if (!run) throw notFound("Run");
    return toRunDto(run);
  }

  async events(id: string, after: number, limit: number): Promise<RunEventsResponse> {
    const exists = await this.prisma.agentRun.count({ where: { id } });
    if (exists === 0) throw notFound("Run");
    const rows = await this.storedEvents(id, after, null, limit + 1);
    const page = rows.slice(0, limit);
    return {
      items: page.map((row) => ({ seq: row.seq, createdAt: row.ts, items: row.items })),
      nextAfter: rows.length > limit ? (page.at(-1)?.seq ?? null) : null,
    };
  }

  async storedEvents(
    runId: string,
    afterSeq: number,
    beforeSeq: number | null,
    limit = 5_000,
  ): Promise<StoredRunEvent[]> {
    const rows = await this.prisma.agentEvent.findMany({
      where: { runId, seq: { gt: afterSeq, ...(beforeSeq === null ? {} : { lt: beforeSeq }) } },
      orderBy: { seq: "asc" },
      take: limit,
    });
    return rows.map(toStoredEvent);
  }

  private async resultEvents(runId: string): Promise<StoredRunEvent[]> {
    const rows = await this.prisma.agentEvent.findMany({
      where: { runId, OR: [{ type: "result" }, { subtype: "result" }] },
      orderBy: { seq: "asc" },
    });
    return rows.map(toStoredEvent);
  }

  async blockedCommands(id: string): Promise<BlockedCommandsResponse> {
    const run = await this.prisma.agentRun.findUnique({
      where: { id },
      select: {
        id: true,
        taskId: true,
        agentConfigId: true,
        agentConfig: { select: { name: true } },
        task: { select: { title: true, project: true } },
      },
    });
    if (!run) throw notFound("Run");
    const commands: string[] = [];
    for (const event of await this.resultEvents(id)) {
      for (const item of event.items) {
        if (item.kind !== "guard" || item.source !== "permission" || item.tool !== "Bash") continue;
        if (item.target !== null && !commands.includes(item.target)) commands.push(item.target);
      }
    }
    const granted = await this.grantedRules(run.task.project.id, {
      taskId: run.taskId,
      agentConfigId: run.agentConfigId,
    });
    const allowed = new Set([...toStringArray(run.task.project.allowedTools), ...granted]);
    const analysis = analyzeCommands(commands);
    return {
      runId: run.id,
      taskId: run.taskId,
      taskTitle: run.task.title,
      projectId: run.task.project.id,
      agentConfigId: run.agentConfigId,
      agentName: run.agentConfig?.name ?? null,
      commands,
      suggestions: analysis.suggestions.map((suggestion) => ({
        ...suggestion,
        allowed: allowed.has(suggestion.rule),
      })),
      refused: analysis.refused,
    };
  }

  async abort(id: string): Promise<RunDto> {
    const run = await this.prisma.agentRun.findUnique({ where: { id } });
    if (!run) throw notFound("Run");
    const settled = this.scheduler.settledRun(id);
    if (!(await this.scheduler.abortRun(id))) throw conflict("Run is not active");
    await settled;
    return this.get(id);
  }
}
