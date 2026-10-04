import { realpath, stat } from "node:fs/promises";
import { sep } from "node:path";
import type {
  CreateProjectRequestSchema,
  ProjectDetailDto,
  ProjectDto,
  ProjectStackDto,
  WorkspaceDraft,
  WorkspaceProposal,
} from "@onyx/contracts";
import { Prisma, type PrismaClient } from "@onyx/db";
import type { z } from "zod";
import { detectStack } from "../domain/stack-commands";
import { proposeWorkspaces, templateFor } from "../domain/workspace-proposal";
import { DEFAULT_WORKSPACES } from "../domain/workspace-templates";
import { badRequest, conflict, notFound } from "../errors";
import { CONTINUE_PROMPT_PREFIX, mergeRules } from "../domain/command-rules";
import { toProjectDto, toStringArray, toWorkspaceDto } from "./mappers";
import { readLayout, readStackFacts } from "./project-setup";

type CreateProjectInput = z.output<typeof CreateProjectRequestSchema>;

const STACK_WINDOW_DAYS = 30;
const COUNT_INCLUDE = { _count: { select: { workspaces: true, tasks: true } } } as const;

export function isWithinRoot(candidate: string, root: string): boolean {
  return candidate === root || candidate.startsWith(root.endsWith(sep) ? root : `${root}${sep}`);
}

export class ProjectService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly allowedRoots: readonly string[],
    private readonly onCreated: (projectId: string) => void = () => undefined,
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
    return {
      ...toProjectDto(project),
      workspaces: project.workspaces.map(toWorkspaceDto),
      allowedTools: toStringArray(project.allowedTools),
    };
  }

  async allowedTools(id: string): Promise<string[]> {
    const project = await this.prisma.project.findUnique({
      where: { id },
      select: { allowedTools: true },
    });
    if (!project) throw notFound("Project");
    return toStringArray(project.allowedTools);
  }

  async setAllowedTools(id: string, rules: readonly string[], actor: string): Promise<string[]> {
    const allowedTools = mergeRules([], rules);
    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.project.updateMany({ where: { id }, data: { allowedTools } });
      if (updated.count === 0) throw notFound("Project");
      await tx.auditLog.create({
        data: { actor, action: "project.allowed-tools", target: id, meta: { allowedTools } },
      });
    });
    return allowedTools;
  }

  async proposal(rootPath: string): Promise<WorkspaceProposal[]> {
    return proposeWorkspaces(await readLayout(await this.resolveRoot(rootPath)));
  }

  async stack(id: string): Promise<ProjectStackDto> {
    const project = await this.prisma.project.findUnique({
      where: { id },
      select: { rootPath: true, allowedTools: true },
    });
    if (!project) throw notFound("Project");
    const allowed = new Set(toStringArray(project.allowedTools));
    const report = detectStack(await readStackFacts(project.rootPath));
    const continuationRuns = await this.prisma.agentRun.count({
      where: {
        task: { projectId: id },
        prompt: { startsWith: CONTINUE_PROMPT_PREFIX },
        startedAt: { gte: new Date(Date.now() - STACK_WINDOW_DAYS * 86_400_000) },
      },
    });
    return {
      continuationRuns,
      windowDays: STACK_WINDOW_DAYS,
      stacks: report.stacks,
      packageManager: report.packageManager,
      commands: report.commands.map((command) => ({
        ...command,
        allowed: allowed.has(command.rule),
      })),
    };
  }

  private async workspaceDrafts(
    input: CreateProjectInput,
    rootPath: string,
  ): Promise<WorkspaceDraft[]> {
    if (input.workspaces) return input.workspaces;
    if (!input.createDefaultWorkspaces) return [];
    if (input.proposeWorkspaces) return proposeWorkspaces(await readLayout(rootPath));
    return DEFAULT_WORKSPACES.map((template) => ({
      name: template.name,
      domain: template.domain,
      pathGlobs: template.pathGlobs,
    }));
  }

  async create(input: CreateProjectInput): Promise<ProjectDetailDto> {
    const rootPath = await this.resolveRoot(input.rootPath);
    const agentConfigs = await this.prisma.agentConfig.findMany({
      select: { id: true, name: true },
    });
    const configIdByName = new Map(agentConfigs.map((config) => [config.name, config.id]));
    const drafts = await this.workspaceDrafts(input, rootPath);
    const names = new Set(drafts.map((draft) => draft.name.toLowerCase()));
    if (names.size !== drafts.length) throw badRequest("Workspace names must be unique");

    try {
      const project = await this.prisma.project.create({
        data: {
          name: input.name,
          rootPath,
          gitRemote: input.gitRemote ?? null,
          defaultBranch: input.defaultBranch,
          ...(drafts.length > 0
            ? {
                workspaces: {
                  create: drafts.map((draft, position) => {
                    const template = templateFor(draft.domain);
                    return {
                      name: draft.name,
                      domain: draft.domain,
                      pathGlobs: draft.pathGlobs,
                      writeFenceGlobs: draft.pathGlobs,
                      resetStrategy: template.resetStrategy,
                      color: template.color,
                      position,
                      agentConfigId: configIdByName.get(template.agentConfigName) ?? null,
                    };
                  }),
                },
              }
            : {}),
        },
      });
      this.onCreated(project.id);
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
