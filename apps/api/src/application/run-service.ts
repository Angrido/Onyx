import {
  normalizeStoredEvent,
  type BlockedCommandsResponse,
  type RunDto,
  type RunEventsResponse,
} from "@onyx/contracts";
import type { PrismaClient } from "@onyx/db";
import { conflict, notFound } from "../errors";
import type { StoredRunEvent } from "../infrastructure/ws-hub";
import { suggestRules } from "../domain/command-rules";
import { RUN_INCLUDE, toRunDto, toStringArray } from "./mappers";
import type { RunScheduler } from "./run-scheduler";

export class RunService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly scheduler: RunScheduler,
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
    return rows.map((row) => ({
      seq: row.seq,
      ts: row.createdAt.toISOString(),
      items: normalizeStoredEvent(row.type, row.payload),
    }));
  }

  async blockedCommands(id: string): Promise<BlockedCommandsResponse> {
    const run = await this.prisma.agentRun.findUnique({
      where: { id },
      select: { id: true, taskId: true, task: { select: { project: true } } },
    });
    if (!run) throw notFound("Run");
    const commands: string[] = [];
    for (const event of await this.storedEvents(id, 0, null)) {
      for (const item of event.items) {
        if (item.kind !== "guard" || item.source !== "permission" || item.tool !== "Bash") continue;
        if (item.target !== null && !commands.includes(item.target)) commands.push(item.target);
      }
    }
    const allowed = new Set(toStringArray(run.task.project.allowedTools));
    return {
      runId: run.id,
      taskId: run.taskId,
      projectId: run.task.project.id,
      commands,
      suggestions: suggestRules(commands).map((suggestion) => ({
        ...suggestion,
        allowed: allowed.has(suggestion.rule),
      })),
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
