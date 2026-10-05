import { realpath, stat } from "node:fs/promises";
import { sep } from "node:path";
import type {
  CommandGrantDto,
  CreateProjectRequestSchema,
  GrantScope,
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
    private readonly share: (root: string) => Promise<void> = () => Promise.resolve(),
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
      commandGrants: await this.commandGrants(id),
    };
  }

  async commandGrants(projectId: string, now = new Date()): Promise<CommandGrantDto[]> {
    const grants = await this.prisma.commandGrant.findMany({
      where: { projectId, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
      include: { task: { select: { title: true } }, agentConfig: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
    });
    return grants.map((grant) => ({
      id: grant.id,
      rule: grant.rule,
      scope: grant.scope,
      command: grant.command,
      taskId: grant.taskId,
      taskTitle: grant.task?.title ?? null,
      agentConfigId: grant.agentConfigId,
      agentName: grant.agentConfig?.name ?? null,
      expiresAt: grant.expiresAt?.toISOString() ?? null,
      createdAt: grant.createdAt.toISOString(),
    }));
  }

  async grantedRules(
    projectId: string,
    target: { taskId: string; agentConfigId: string | null },
    now = new Date(),
  ): Promise<string[]> {
    const grants = await this.prisma.commandGrant.findMany({
      where: {
        projectId,
        AND: [
          { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
          {
            OR: [
              { scope: "PROJECT" },
              { scope: "TASK", taskId: target.taskId },
              ...(target.agentConfigId
                ? [{ scope: "AGENT" as const, agentConfigId: target.agentConfigId }]
                : []),
            ],
          },
        ],
      },
      select: { rule: true },
    });
    return mergeRules(
      [],
      grants.map((grant) => grant.rule),
    );
  }

  async grant(input: {
    projectId: string;
    rules: readonly { rule: string; command: string | null }[];
    scope: GrantScope;
    taskId: string;
    agentConfigId: string | null;
    expiresAt: Date | null;
    actor: string;
  }): Promise<void> {
    if (input.rules.length === 0) return;
    if (input.scope === "PROJECT" && input.expiresAt === null) {
      const current = await this.allowedTools(input.projectId);
      await this.setAllowedTools(
        input.projectId,
        mergeRules(
          current,
          input.rules.map((entry) => entry.rule),
        ),
        input.actor,
      );
      return;
    }
    if (input.scope === "AGENT" && input.agentConfigId === null)
      throw badRequest("This run has no agent profile: allow the commands for the task instead");
    await this.prisma.$transaction(async (tx) => {
      await tx.commandGrant.createMany({
        data: input.rules.map((entry) => ({
          projectId: input.projectId,
          rule: entry.rule,
          scope: input.scope,
          taskId: input.scope === "TASK" ? input.taskId : null,
          agentConfigId: input.scope === "AGENT" ? input.agentConfigId : null,
          command: entry.command,
          expiresAt: input.expiresAt,
          createdBy: input.actor,
        })),
      });
      await tx.auditLog.create({
        data: {
          actor: input.actor,
          action: "project.command-grant",
          target: input.projectId,
          meta: {
            rules: input.rules.map((entry) => entry.rule),
            scope: input.scope,
            taskId: input.taskId,
            agentConfigId: input.agentConfigId,
            expiresAt: input.expiresAt?.toISOString() ?? null,
          },
        },
      });
    });
  }

  async revokeGrant(projectId: string, grantId: string, actor: string): Promise<void> {
    const removed = await this.prisma.commandGrant.deleteMany({
      where: { id: grantId, projectId },
    });
    if (removed.count === 0) throw notFound("Allowed command");
    await this.prisma.auditLog.create({
      data: {
        actor,
        action: "project.command-grant.revoked",
        target: projectId,
        meta: { grantId },
      },
    });
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
      await this.share(rootPath);
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
