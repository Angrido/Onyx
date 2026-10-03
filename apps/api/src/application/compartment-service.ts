import { randomUUID } from "node:crypto";
import type { SessionDto, SessionEndReason, SessionItem } from "@onyx/contracts";
import type { ModelProfile, Prisma, PrismaClient, Session, Workspace } from "@onyx/db";
import type { TokenEstimator } from "@onyx/lean-ctx";
import type { Logger } from "pino";
import {
  composeHandoff,
  HANDOFF_BUDGET_TOKENS,
  type Handoff,
  type RunDigest,
} from "../domain/handoff";
import { decideSession, wantsHandoff, type SessionDecision } from "../domain/session-policy";
import { conflict, notFound } from "../errors";
import type { HandoffSummarizer } from "../infrastructure/aux-model";
import { toSessionDto, toStringArray } from "./mappers";
import { priceUsage } from "./router-service";

export interface CompartmentServiceDeps {
  prisma: PrismaClient;
  estimator: TokenEstimator;
  summarizer: HandoffSummarizer | null;
  logger: Logger;
  isBusy: (workspaceId: string) => boolean;
}

export interface SessionPlan {
  session: Session;
  decision: SessionDecision;
  item: SessionItem;
}

export interface PrepareSessionInput {
  projectId: string;
  workspace: Workspace;
  modelId: string;
  forceNew: boolean;
}

const MAX_OWN_RUNS = 8;
const MAX_FOREIGN_RUNS = 10;
const FOREIGN_WINDOW_MS = 7 * 86_400_000;

const RUN_DIGEST_INCLUDE = {
  task: { select: { title: true, resultSummary: true } },
  session: { select: { workspace: { select: { name: true } } } },
} as const;

type DigestRun = Prisma.AgentRunGetPayload<{ include: typeof RUN_DIGEST_INCLUDE }>;

function toDigests(runs: readonly DigestRun[]): RunDigest[] {
  const lastRunOfTask = new Map<string, string>();
  for (const run of runs) lastRunOfTask.set(run.taskId, run.id);
  return runs.map((run) => ({
    workspaceName: run.session.workspace.name,
    taskTitle: run.task.title,
    status: run.status,
    endedAt: run.endedAt,
    changedFiles: toStringArray(run.changedFiles),
    summary:
      lastRunOfTask.get(run.taskId) === run.id
        ? (run.task.resultSummary ?? run.errorMessage)
        : run.errorMessage,
  }));
}

export class CompartmentService {
  constructor(private readonly deps: CompartmentServiceDeps) {}

  async prepare(input: PrepareSessionInput): Promise<SessionPlan> {
    const { prisma } = this.deps;
    const { workspace } = input;
    const active = workspace.activeSessionId
      ? await prisma.session.findUnique({
          where: { id: workspace.activeSessionId },
          include: { _count: { select: { runs: true } } },
        })
      : null;
    const foreignChangeAt = active
      ? await this.foreignChangeSince(input.projectId, workspace.id, active.lastActivityAt)
      : null;
    const decision = decideSession(
      active
        ? {
            id: active.id,
            modelId: active.modelId,
            status: active.status,
            contextTokens: active.contextTokens,
            established: active.claudeSessionId !== null,
            pending: active.claudeSessionId === null && active._count.runs === 0,
            lastActivityAt: active.lastActivityAt,
          }
        : null,
      {
        modelId: input.modelId,
        forceNew: input.forceNew,
        maxSessionTokens: workspace.maxSessionTokens,
        foreignChangeAt,
      },
    );
    const base = {
      kind: "session" as const,
      workspaceName: workspace.name,
      maxSessionTokens: workspace.maxSessionTokens,
    };

    if (decision.action === "resume") {
      const session = await prisma.session.update({
        where: { id: decision.sessionId },
        data: { status: "ACTIVE", lastActivityAt: new Date() },
      });
      return {
        session,
        decision,
        item: {
          ...base,
          action: "resumed",
          sessionId: session.id,
          reason: null,
          previousSessionId: session.previousId,
          handoff: null,
          contextTokens: session.contextTokens,
        },
      };
    }

    if (decision.reuse !== null) {
      const session = await prisma.session.update({
        where: { id: decision.reuse },
        data: { status: "ACTIVE", modelId: input.modelId, lastActivityAt: new Date() },
      });
      const previous = session.previousId
        ? await prisma.session.findUnique({ where: { id: session.previousId } })
        : null;
      return {
        session,
        decision,
        item: {
          ...base,
          action: "started",
          sessionId: session.id,
          reason: previous?.endReason ?? null,
          previousSessionId: session.previousId,
          handoff:
            session.handoffNote !== null
              ? { text: session.handoffNote, tokens: session.handoffTokens ?? 0 }
              : null,
          contextTokens: 0,
        },
      };
    }

    const reason = decision.rotate?.reason ?? null;
    const previousOwn =
      active && decision.rotate ? active : await this.latestEndedSession(workspace.id);
    const handoff = wantsHandoff(workspace.resetStrategy, reason)
      ? await this.composeFor(input.projectId, workspace, previousOwn, reason)
      : null;
    const session = await prisma.$transaction(async (tx) => {
      if (decision.rotate) {
        await tx.session.update({
          where: { id: decision.rotate.sessionId },
          data: { status: "ROTATED", endReason: decision.rotate.reason, endedAt: new Date() },
        });
      }
      const previousId = await this.chainableId(tx, previousOwn?.id ?? null);
      const created = await tx.session.create({
        data: {
          id: randomUUID(),
          workspaceId: workspace.id,
          modelId: input.modelId,
          status: "ACTIVE",
          previousId,
          handoffNote: handoff?.text ?? null,
          handoffTokens: handoff?.tokens ?? null,
        },
      });
      await tx.workspace.update({
        where: { id: workspace.id },
        data: { activeSessionId: created.id },
      });
      return created;
    });
    return {
      session,
      decision,
      item: {
        ...base,
        action: "started",
        sessionId: session.id,
        reason,
        previousSessionId: session.previousId,
        handoff: handoff ? { text: handoff.text, tokens: handoff.tokens } : null,
        contextTokens: 0,
      },
    };
  }

  async reset(workspaceId: string, handoff: boolean, actor: string): Promise<SessionDto | null> {
    const { prisma } = this.deps;
    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      include: { activeSession: true, agentConfig: true },
    });
    if (!workspace) throw notFound("Workspace");
    if (this.deps.isBusy(workspaceId)) throw conflict("Workspace has a running agent");
    const previous = workspace.activeSession ?? (await this.latestEndedSession(workspaceId));
    const note = handoff
      ? await this.composeFor(workspace.projectId, workspace, previous, "MANUAL_RESET")
      : null;
    const modelId = previous?.modelId ?? workspace.agentConfig?.modelId ?? null;
    const created = await prisma.$transaction(async (tx) => {
      if (workspace.activeSession && workspace.activeSession.status !== "ROTATED") {
        await tx.session.update({
          where: { id: workspace.activeSession.id },
          data: { status: "ROTATED", endReason: "MANUAL_RESET", endedAt: new Date() },
        });
      }
      if (!note || modelId === null) {
        await tx.workspace.update({ where: { id: workspaceId }, data: { activeSessionId: null } });
        return null;
      }
      const session = await tx.session.create({
        data: {
          id: randomUUID(),
          workspaceId,
          modelId,
          status: "IDLE",
          previousId: await this.chainableId(tx, previous?.id ?? null),
          handoffNote: note.text,
          handoffTokens: note.tokens,
        },
      });
      await tx.workspace.update({
        where: { id: workspaceId },
        data: { activeSessionId: session.id },
      });
      return session;
    });
    await prisma.auditLog.create({
      data: {
        actor,
        action: "workspace.reset",
        target: workspaceId,
        meta: {
          handoff,
          handoffTokens: note?.tokens ?? null,
          pendingSessionId: created?.id ?? null,
        },
      },
    });
    return created ? toSessionDto({ ...created, _count: { runs: 0 } }) : null;
  }

  async sessions(workspaceId: string): Promise<SessionDto[]> {
    const sessions = await this.deps.prisma.session.findMany({
      where: { workspaceId },
      include: { _count: { select: { runs: true } } },
      orderBy: { startedAt: "desc" },
      take: 50,
    });
    return sessions.map(toSessionDto);
  }

  async foreignChangeSince(
    projectId: string,
    workspaceId: string,
    since: Date,
  ): Promise<Date | null> {
    const runs = await this.deps.prisma.agentRun.findMany({
      where: {
        task: { projectId },
        session: { workspaceId: { not: workspaceId } },
        endedAt: { gt: since },
      },
      orderBy: { endedAt: "desc" },
      take: 50,
      select: { endedAt: true, changedFiles: true },
    });
    const changed = runs.find((run) => toStringArray(run.changedFiles).length > 0);
    return changed?.endedAt ?? null;
  }

  async composeFor(
    projectId: string,
    workspace: Pick<Workspace, "id" | "name">,
    previousOwn: Pick<Session, "id" | "startedAt"> | null,
    reason: SessionEndReason | null,
  ): Promise<Handoff | null> {
    const { prisma, estimator } = this.deps;
    const since = previousOwn?.startedAt ?? new Date(Date.now() - FOREIGN_WINDOW_MS);
    const [own, foreign] = await Promise.all([
      previousOwn
        ? prisma.agentRun.findMany({
            where: { sessionId: previousOwn.id, endedAt: { not: null } },
            include: RUN_DIGEST_INCLUDE,
            orderBy: { startedAt: "desc" },
            take: MAX_OWN_RUNS,
          })
        : Promise.resolve([]),
      prisma.agentRun.findMany({
        where: {
          task: { projectId },
          session: { workspaceId: { not: workspace.id } },
          endedAt: { gte: since },
        },
        include: RUN_DIGEST_INCLUDE,
        orderBy: { endedAt: "desc" },
        take: MAX_FOREIGN_RUNS,
      }),
    ]);
    const draft = composeHandoff({
      workspaceName: workspace.name,
      reason,
      own: toDigests([...own].reverse()),
      foreign: toDigests([...foreign].reverse()),
      budgetTokens: HANDOFF_BUDGET_TOKENS,
      estimate: (text) => estimator.estimate(text, "markdown"),
    });
    if (!draft || !this.deps.summarizer) return draft;
    try {
      const summary = await this.deps.summarizer.summarize({
        workspaceName: workspace.name,
        draft: draft.text,
        budgetTokens: HANDOFF_BUDGET_TOKENS,
      });
      await this.recordAux(summary.usage.modelId, summary.usage.usage);
      const tokens = estimator.estimate(summary.text, "markdown");
      return tokens <= HANDOFF_BUDGET_TOKENS ? { ...draft, text: summary.text, tokens } : draft;
    } catch (error) {
      this.deps.logger.warn({ err: error }, "Handoff summarizer failed; using the structured note");
      return draft;
    }
  }

  private async latestEndedSession(workspaceId: string): Promise<Session | null> {
    return this.deps.prisma.session.findFirst({
      where: { workspaceId, status: { in: ["ROTATED", "CLOSED"] } },
      orderBy: { startedAt: "desc" },
    });
  }

  private async chainableId(
    tx: Prisma.TransactionClient,
    id: string | null,
  ): Promise<string | null> {
    if (id === null) return null;
    const taken = await tx.session.findFirst({ where: { previousId: id }, select: { id: true } });
    return taken ? null : id;
  }

  private async recordAux(modelId: string, usage: Parameters<typeof priceUsage>[0]): Promise<void> {
    const profile: ModelProfile | null = await this.deps.prisma.modelProfile.findUnique({
      where: { id: modelId },
    });
    await this.deps.prisma.tokenLog
      .create({
        data: {
          modelId,
          scope: "AUX",
          purpose: "handoff",
          ...usage,
          costUsd: profile ? priceUsage(usage, profile) : null,
        },
      })
      .catch((error: unknown) => this.deps.logger.warn({ err: error }, "Aux token log failed"));
  }
}
