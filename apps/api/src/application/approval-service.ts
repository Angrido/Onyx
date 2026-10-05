import type {
  ApprovalDto,
  ApprovalKind,
  ApprovalListQuerySchema,
  ApprovalListResponse,
} from "@onyx/contracts";
import type { Approval, Prisma, PrismaClient } from "@onyx/db";
import type { Logger } from "pino";
import type { z } from "zod";
import { conflict, notFound } from "../errors";
import type { WsHub } from "../infrastructure/ws-hub";
import { toStringArray } from "./mappers";

type ListInput = z.output<typeof ApprovalListQuerySchema>;

export interface ApprovalPayload {
  key: string;
  detail?: string | null;
  orchestrationId?: string | null;
  budgetId?: string | null;
  periodKey?: string | null;
  link?: string | null;
  files?: string[];
  approveLabel?: string;
  rejectLabel?: string;
}

export interface ApprovalHandler {
  approve(approval: Approval, payload: ApprovalPayload, actor: string): Promise<void>;
  reject(approval: Approval, payload: ApprovalPayload, actor: string): Promise<void>;
}

export interface CreateApprovalInput {
  kind: ApprovalKind;
  title: string;
  payload: ApprovalPayload;
  taskId?: string | null;
  projectId?: string | null;
}

export interface ApprovalServiceDeps {
  prisma: PrismaClient;
  logger: Logger;
  hub: Pick<WsHub, "publishApprovals">;
  onCreated?: (approval: Approval) => void;
}

function readPayload(value: Prisma.JsonValue): ApprovalPayload {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return { key: "" };
  const record = value as Record<string, unknown>;
  const text = (name: string): string | null =>
    typeof record[name] === "string" ? (record[name] as string) : null;
  return {
    key: text("key") ?? "",
    detail: text("detail"),
    orchestrationId: text("orchestrationId"),
    budgetId: text("budgetId"),
    periodKey: text("periodKey"),
    link: text("link"),
    files: toStringArray(record["files"]),
    approveLabel: text("approveLabel") ?? "Approve",
    rejectLabel: text("rejectLabel") ?? "Reject",
  };
}

export class ApprovalService {
  private readonly handlers = new Map<ApprovalKind, ApprovalHandler>();
  private readonly localizers = new Map<ApprovalKind, (text: string) => string>();

  constructor(private readonly deps: ApprovalServiceDeps) {}

  register(
    kind: ApprovalKind,
    handler: ApprovalHandler,
    localize?: (text: string) => string,
  ): void {
    this.handlers.set(kind, handler);
    if (localize) this.localizers.set(kind, localize);
  }

  localizedTitle(approval: Pick<Approval, "kind" | "title">): string {
    return this.localize(approval.kind, approval.title);
  }

  private localize(kind: ApprovalKind, text: string): string {
    const localize = this.localizers.get(kind);
    return localize ? localize(text) : text;
  }

  async create(input: CreateApprovalInput): Promise<Approval> {
    const { prisma } = this.deps;
    const existing = await prisma.approval.findMany({
      where: { kind: input.kind, status: "PENDING" },
    });
    const same = existing.find(
      (approval) => readPayload(approval.payload).key === input.payload.key,
    );
    if (same) return same;
    const approval = await prisma.approval.create({
      data: {
        kind: input.kind,
        title: input.title,
        payload: { ...input.payload },
        taskId: input.taskId ?? null,
        projectId: input.projectId ?? null,
      },
    });
    await this.announce();
    this.deps.onCreated?.(approval);
    return approval;
  }

  async list(query: ListInput): Promise<ApprovalListResponse> {
    const { prisma } = this.deps;
    const rows = await prisma.approval.findMany({
      where: query.status ? { status: query.status } : {},
      include: { project: { select: { name: true } } },
      orderBy: [{ createdAt: "desc" }],
      take: query.limit,
    });
    const pending = await prisma.approval.count({ where: { status: "PENDING" } });
    const order = (approval: { status: string }) => (approval.status === "PENDING" ? 0 : 1);
    return {
      items: rows.sort((a, b) => order(a) - order(b)).map((row) => this.toDto(row)),
      pending,
    };
  }

  async get(id: string): Promise<ApprovalDto> {
    const row = await this.deps.prisma.approval.findUnique({
      where: { id },
      include: { project: { select: { name: true } } },
    });
    if (!row) throw notFound("Approval");
    return this.toDto(row);
  }

  async decide(
    id: string,
    decision: "approve" | "reject",
    actor: string,
    note: string | null,
  ): Promise<ApprovalDto> {
    const { prisma, logger } = this.deps;
    const approval = await prisma.approval.findUnique({ where: { id } });
    if (!approval) throw notFound("Approval");
    if (approval.status !== "PENDING")
      throw conflict(`This request was already ${approval.status.toLowerCase()}`);
    const claimed = await prisma.approval.updateMany({
      where: { id, status: "PENDING" },
      data: {
        status: decision === "approve" ? "APPROVED" : "REJECTED",
        decidedBy: actor,
        decidedAt: new Date(),
        note,
      },
    });
    if (claimed.count === 0) throw conflict("This request was decided meanwhile");
    const handler = this.handlers.get(approval.kind);
    const payload = readPayload(approval.payload);
    try {
      if (handler) {
        if (decision === "approve") await handler.approve(approval, payload, actor);
        else await handler.reject(approval, payload, actor);
      }
    } catch (error) {
      logger.warn({ err: error, approvalId: id }, "Approval handler failed");
      await prisma.approval.update({
        where: { id },
        data: { status: "PENDING", decidedBy: null, decidedAt: null, note: null },
      });
      await this.announce();
      throw error;
    }
    await prisma.auditLog
      .create({
        data: {
          actor,
          action: `approval.${decision}`,
          target: id,
          meta: { kind: approval.kind, title: approval.title },
        },
      })
      .catch(() => undefined);
    await this.announce();
    return this.get(id);
  }

  async expire(where: (payload: ApprovalPayload, approval: Approval) => boolean): Promise<number> {
    const { prisma } = this.deps;
    const pending = await prisma.approval.findMany({ where: { status: "PENDING" } });
    const ids = pending
      .filter((approval) => where(readPayload(approval.payload), approval))
      .map((approval) => approval.id);
    if (ids.length === 0) return 0;
    await prisma.approval.updateMany({
      where: { id: { in: ids } },
      data: { status: "EXPIRED", decidedAt: new Date() },
    });
    await this.announce();
    return ids.length;
  }

  async pendingFor(kind: ApprovalKind, key: string): Promise<Approval | null> {
    const rows = await this.deps.prisma.approval.findMany({ where: { kind, status: "PENDING" } });
    return rows.find((approval) => readPayload(approval.payload).key === key) ?? null;
  }

  private async announce(): Promise<void> {
    const pending = await this.deps.prisma.approval.count({ where: { status: "PENDING" } });
    this.deps.hub.publishApprovals(pending);
  }

  private toDto(row: Approval & { project?: { name: string } | null }): ApprovalDto {
    const payload = readPayload(row.payload);
    return {
      id: row.id,
      kind: row.kind,
      status: row.status,
      title: this.localize(row.kind, row.title),
      detail: payload.detail ? this.localize(row.kind, payload.detail) : (payload.detail ?? null),
      projectId: row.projectId,
      projectName: row.project?.name ?? null,
      taskId: row.taskId,
      orchestrationId: payload.orchestrationId ?? null,
      link: payload.link ?? null,
      files: payload.files ?? [],
      approveLabel: payload.approveLabel ?? "Approve",
      rejectLabel: payload.rejectLabel ?? "Reject",
      decidedBy: row.decidedBy,
      note: row.note,
      createdAt: row.createdAt.toISOString(),
      decidedAt: row.decidedAt?.toISOString() ?? null,
    };
  }
}
