import type {
  CreateWorkspaceRequestSchema,
  SessionDto,
  UpdateWorkspaceRequestSchema,
  WorkspaceDto,
} from "@onyx/contracts";
import { Prisma, type PrismaClient } from "@onyx/db";
import type { z } from "zod";
import { conflict, notFound } from "../errors";
import { toSessionDto, toWorkspaceDto } from "./mappers";

type CreateWorkspaceInput = z.output<typeof CreateWorkspaceRequestSchema>;
type UpdateWorkspaceInput = z.output<typeof UpdateWorkspaceRequestSchema>;

export class WorkspaceService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly isBusy: (workspaceId: string) => boolean,
  ) {}

  async list(projectId: string): Promise<WorkspaceDto[]> {
    const workspaces = await this.prisma.workspace.findMany({
      where: { projectId },
      orderBy: { position: "asc" },
    });
    return workspaces.map(toWorkspaceDto);
  }

  async create(projectId: string, input: CreateWorkspaceInput): Promise<WorkspaceDto> {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw notFound("Project");
    const position = await this.prisma.workspace.count({ where: { projectId } });
    try {
      const workspace = await this.prisma.workspace.create({
        data: {
          projectId,
          name: input.name,
          domain: input.domain,
          pathGlobs: input.pathGlobs,
          writeFenceGlobs: input.writeFenceGlobs ?? input.pathGlobs,
          primer: input.primer ?? null,
          resetStrategy: input.resetStrategy,
          maxSessionTokens: input.maxSessionTokens,
          agentConfigId: input.agentConfigId ?? null,
          color: input.color ?? null,
          position,
        },
      });
      return toWorkspaceDto(workspace);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw conflict("A workspace with this name already exists in the project");
      }
      throw error;
    }
  }

  async update(id: string, input: UpdateWorkspaceInput): Promise<WorkspaceDto> {
    const existing = await this.prisma.workspace.findUnique({ where: { id } });
    if (!existing) throw notFound("Workspace");
    const data: Prisma.WorkspaceUncheckedUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.pathGlobs !== undefined) data.pathGlobs = input.pathGlobs;
    if (input.writeFenceGlobs !== undefined) data.writeFenceGlobs = input.writeFenceGlobs;
    if (input.primer !== undefined) data.primer = input.primer;
    if (input.resetStrategy !== undefined) data.resetStrategy = input.resetStrategy;
    if (input.maxSessionTokens !== undefined) data.maxSessionTokens = input.maxSessionTokens;
    if (input.agentConfigId !== undefined) data.agentConfigId = input.agentConfigId;
    if (input.color !== undefined) data.color = input.color;
    const workspace = await this.prisma.workspace.update({ where: { id }, data });
    return toWorkspaceDto(workspace);
  }

  async resetSession(id: string): Promise<WorkspaceDto> {
    const workspace = await this.prisma.workspace.findUnique({ where: { id } });
    if (!workspace) throw notFound("Workspace");
    if (this.isBusy(id)) throw conflict("Workspace has a running agent");
    const updated = await this.prisma.$transaction(async (tx) => {
      if (workspace.activeSessionId) {
        await tx.session.update({
          where: { id: workspace.activeSessionId },
          data: { status: "ROTATED", endReason: "MANUAL_RESET", endedAt: new Date() },
        });
      }
      return tx.workspace.update({ where: { id }, data: { activeSessionId: null } });
    });
    return toWorkspaceDto(updated);
  }

  async sessions(id: string): Promise<SessionDto[]> {
    const sessions = await this.prisma.session.findMany({
      where: { workspaceId: id },
      orderBy: { startedAt: "desc" },
      take: 50,
    });
    return sessions.map(toSessionDto);
  }
}
