import { realpath, stat } from "node:fs/promises";
import { sep } from "node:path";
import type { CreateProjectRequestSchema, ProjectDetailDto, ProjectDto } from "@onyx/contracts";
import { Prisma, type PrismaClient } from "@onyx/db";
import type { z } from "zod";
import { DEFAULT_WORKSPACES } from "../domain/workspace-templates";
import { badRequest, conflict, notFound } from "../errors";
import { toProjectDto, toWorkspaceDto } from "./mappers";

type CreateProjectInput = z.output<typeof CreateProjectRequestSchema>;

const COUNT_INCLUDE = { _count: { select: { workspaces: true, tasks: true } } } as const;

export function isWithinRoot(candidate: string, root: string): boolean {
  return candidate === root || candidate.startsWith(root.endsWith(sep) ? root : `${root}${sep}`);
}

export class ProjectService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly allowedRoots: readonly string[],
  ) {}

  async list(): Promise<ProjectDto[]> {
    const projects = await this.prisma.project.findMany({
      include: COUNT_INCLUDE,
      orderBy: { createdAt: "desc" },
    });
    return projects.map(toProjectDto);
  }

  async get(id: string): Promise<ProjectDetailDto> {
    const project = await this.prisma.project.findUnique({
      where: { id },
      include: { ...COUNT_INCLUDE, workspaces: { orderBy: { position: "asc" } } },
    });
    if (!project) throw notFound("Project");
    return { ...toProjectDto(project), workspaces: project.workspaces.map(toWorkspaceDto) };
  }

  async create(input: CreateProjectInput): Promise<ProjectDetailDto> {
    const rootPath = await this.resolveRoot(input.rootPath);
    const agentConfigs = await this.prisma.agentConfig.findMany({
      select: { id: true, name: true },
    });
    const configIdByName = new Map(agentConfigs.map((config) => [config.name, config.id]));

    try {
      const project = await this.prisma.project.create({
        data: {
          name: input.name,
          rootPath,
          gitRemote: input.gitRemote ?? null,
          defaultBranch: input.defaultBranch,
          ...(input.createDefaultWorkspaces
            ? {
                workspaces: {
                  create: DEFAULT_WORKSPACES.map((template, position) => ({
                    name: template.name,
                    domain: template.domain,
                    pathGlobs: template.pathGlobs,
                    writeFenceGlobs: template.pathGlobs,
                    resetStrategy: template.resetStrategy,
                    color: template.color,
                    position,
                    agentConfigId: configIdByName.get(template.agentConfigName) ?? null,
                  })),
                },
              }
            : {}),
        },
      });
      return this.get(project.id);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw conflict("A project with the same name or root path already exists");
      }
      throw error;
    }
  }

  async remove(id: string): Promise<void> {
    const active = await this.prisma.task.count({
      where: { projectId: id, status: { in: ["QUEUED", "RUNNING", "TDD_LOOP", "PLANNING"] } },
    });
    if (active > 0) throw conflict("Project has active tasks");
    const deleted = await this.prisma.project.deleteMany({ where: { id } });
    if (deleted.count === 0) throw notFound("Project");
  }

  private async resolveRoot(rootPath: string): Promise<string> {
    const resolved = await realpath(rootPath).catch(() => null);
    if (resolved === null) throw badRequest(`Path ${rootPath} does not exist`);
    const stats = await stat(resolved);
    if (!stats.isDirectory()) throw badRequest(`Path ${rootPath} is not a directory`);
    const roots = await Promise.all(
      this.allowedRoots.map((root) => realpath(root).catch(() => root)),
    );
    if (!roots.some((root) => isWithinRoot(resolved, root))) {
      throw badRequest(`Path must be inside one of: ${roots.join(", ")}`);
    }
    return resolved;
  }
}
