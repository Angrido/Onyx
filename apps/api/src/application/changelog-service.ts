import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type {
  ChangelogPreviewDto,
  ChangelogReleaseDto,
  SaveChangelogRequestSchema,
  SaveChangelogResponse,
} from "@onyx/contracts";
import type { ChangelogRelease, PrismaClient } from "@onyx/db";
import type { Logger } from "pino";
import type { z } from "zod";
import {
  buildChangelogEntries,
  prependChangelog,
  renderChangelog,
  suggestVersion,
} from "../domain/changelog";
import { badRequest, conflict } from "../errors";
import { withSharedUmask } from "../infrastructure/git-env";
import type { GitService } from "./git-service";

type SaveInput = z.output<typeof SaveChangelogRequestSchema>;

export const CHANGELOG_FILE = "CHANGELOG.md";
const MAX_COMMITS = 300;
const MAX_TASKS = 200;
const SAFE_REF = /^[\w][\w./@^~-]{0,199}$/;

export interface ChangelogServiceDeps {
  prisma: PrismaClient;
  logger: Logger;
  git: Pick<GitService, "githubRepo" | "busy" | "commits" | "head" | "refInfo" | "latestTag">;
  now?: () => Date;
}

function toReleaseDto(release: ChangelogRelease): ChangelogReleaseDto {
  return {
    id: release.id,
    version: release.version,
    fromRef: release.fromRef,
    toRef: release.toRef,
    createdAt: release.createdAt.toISOString(),
  };
}

function readText(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

export class ChangelogService {
  constructor(private readonly deps: ChangelogServiceDeps) {}

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  async preview(projectId: string, from?: string): Promise<ChangelogPreviewDto> {
    if (from !== undefined && !SAFE_REF.test(from)) throw badRequest("Invalid starting point");
    const { project } = await this.deps.git.githubRepo(projectId);
    const releases = await this.deps.prisma.changelogRelease.findMany({
      where: { projectId },
      orderBy: { createdAt: "desc" },
      take: 10,
    });
    const tag = await this.deps.git.latestTag(projectId);
    const start = await this.start(projectId, from, releases[0] ?? null, tag);
    const [commits, toRef] = await Promise.all([
      this.deps.git.commits(projectId, start?.sha ?? null, MAX_COMMITS),
      this.deps.git.head(projectId),
    ]);
    const since = start ? start.since : null;
    const tasks = await this.deps.prisma.task.findMany({
      where: {
        projectId,
        status: "COMPLETED",
        parentTaskId: null,
        ...(since ? { completedAt: { gt: since } } : {}),
      },
      orderBy: { completedAt: "asc" },
      take: MAX_TASKS,
      select: { id: true, title: true, kind: true },
    });
    const entries = buildChangelogEntries(commits, tasks);
    const today = this.now().toISOString().slice(0, 10);
    const previousVersion = releases[0]?.version ?? tag;
    const version = suggestVersion(previousVersion, entries, today);
    return {
      fromRef: start?.sha ?? null,
      fromLabel: start?.label ?? null,
      toRef,
      version,
      commits: commits.length,
      tasks: tasks.length,
      entries,
      markdown: renderChangelog(version, today, entries),
      file: CHANGELOG_FILE,
      fileExists: readText(join(project.rootPath, CHANGELOG_FILE)) !== null,
      releases: releases.map(toReleaseDto),
    };
  }

  async save(projectId: string, input: SaveInput, actor: string): Promise<SaveChangelogResponse> {
    const { project } = await this.deps.git.githubRepo(projectId);
    if (await this.deps.git.busy(projectId))
      throw conflict("An agent is working on this project: wait until it finishes");
    const toRef = await this.deps.git.head(projectId);
    if (!toRef) throw badRequest("The project has no commits yet");
    const latest = await this.deps.prisma.changelogRelease.findFirst({
      where: { projectId },
      orderBy: { createdAt: "desc" },
    });
    const tag = await this.deps.git.latestTag(projectId);
    const start = await this.start(projectId, undefined, latest, tag);
    const path = join(project.rootPath, CHANGELOG_FILE);
    const next = prependChangelog(readText(path), input.markdown);
    withSharedUmask(() => writeFileSync(path, next, "utf8"));
    const release = await this.deps.prisma.changelogRelease.create({
      data: {
        projectId,
        version: input.version,
        fromRef: start?.sha ?? null,
        toRef,
        markdown: input.markdown,
      },
    });
    await this.deps.prisma.auditLog
      .create({
        data: {
          actor,
          action: "changelog.saved",
          target: projectId,
          meta: { version: input.version, toRef },
        },
      })
      .catch((error: unknown) => this.deps.logger.warn({ err: error }, "Audit write failed"));
    return { release: toReleaseDto(release), file: CHANGELOG_FILE };
  }

  private async start(
    projectId: string,
    from: string | undefined,
    latest: ChangelogRelease | null,
    tag: string | null,
  ): Promise<{ sha: string; date: string; label: string; since: Date } | null> {
    if (from) {
      const info = await this.deps.git.refInfo(projectId, from);
      if (!info) throw badRequest(`${from} is not a commit of the current branch`);
      return { ...info, label: from, since: new Date(info.date) };
    }
    if (latest) {
      const info = await this.deps.git.refInfo(projectId, latest.toRef);
      if (info) return { ...info, label: latest.version, since: latest.createdAt };
    }
    if (tag) {
      const info = await this.deps.git.refInfo(projectId, tag);
      if (info) return { ...info, label: tag, since: new Date(info.date) };
    }
    return null;
  }
}
