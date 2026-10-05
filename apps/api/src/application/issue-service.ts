import type {
  GitHubIssueDto,
  GitHubIssueListResponse,
  ImportIssuesRequestSchema,
  ImportIssuesResponse,
  TaskDto,
} from "@onyx/contracts";
import type { PrismaClient } from "@onyx/db";
import type { Logger } from "pino";
import type { z } from "zod";
import { issueExcerpt, issuePrompt, issueTitle, kindFromLabels } from "../domain/pull-requests";
import { badRequest } from "../errors";
import {
  GITHUB_FAILURE_KEYS,
  GitHubError,
  type GitHubClient,
  type GitHubIssue,
} from "../infrastructure/github-client";
import type { GitHubService } from "./github-service";
import type { GitService } from "./git-service";
import type { IndexService } from "./index-service";
import type { TaskService } from "./task-service";
import { githubFailure } from "./pull-request-service";
import { tx, txKnown } from "../i18n";

type ImportInput = z.output<typeof ImportIssuesRequestSchema>;

const MAX_INFERRED_TARGETS = 5;

export interface IssueServiceDeps {
  prisma: PrismaClient;
  logger: Logger;
  client: GitHubClient;
  github: Pick<GitHubService, "token">;
  git: Pick<GitService, "githubRepo">;
  indexes: Pick<IndexService, "context">;
  tasks: Pick<TaskService, "create">;
}

function labelsOf(issue: GitHubIssue): string[] {
  return issue.labels.flatMap((label) =>
    typeof label === "string" ? [label] : label.name ? [label.name] : [],
  );
}

export class IssueService {
  constructor(private readonly deps: IssueServiceDeps) {}

  async list(projectId: string, page: number, label?: string): Promise<GitHubIssueListResponse> {
    const { repo } = await this.deps.git.githubRepo(projectId);
    if (!repo) return { repo: null, page, hasNext: false, items: [] };
    const token = await this.deps.github.token();
    const result = await this.deps.client
      .issues(repo, token, page, label)
      .catch((error: unknown) => {
        throw githubFailure(error);
      });
    const imported = await this.imported(
      projectId,
      repo,
      result.issues.map((issue) => issue.number),
    );
    return {
      repo,
      page,
      hasNext: result.hasNext,
      items: result.issues.map((issue): GitHubIssueDto => ({
        number: issue.number,
        title: issueTitle(issue.title),
        url: issue.html_url,
        labels: labelsOf(issue),
        author: issue.user?.login ?? null,
        comments: issue.comments,
        createdAt: issue.created_at,
        updatedAt: issue.updated_at,
        excerpt: issueExcerpt(issue.body ?? null),
        importedTaskId: imported.get(issue.number) ?? null,
      })),
    };
  }

  async import(projectId: string, input: ImportInput): Promise<ImportIssuesResponse> {
    const { repo } = await this.deps.git.githubRepo(projectId);
    if (!repo) throw badRequest("The project has no GitHub remote");
    const token = await this.deps.github.token();
    const numbers = [...new Set(input.numbers)];
    const imported = await this.imported(projectId, repo, numbers);
    const context = await this.deps.indexes.context(projectId);
    const items: TaskDto[] = [];
    const skipped: ImportIssuesResponse["skipped"] = [];
    for (const number of numbers) {
      if (imported.has(number)) {
        skipped.push({ number, reason: tx("Already imported") });
        continue;
      }
      let issue: GitHubIssue;
      try {
        issue = await this.deps.client.issue(repo, number, token);
      } catch (error) {
        skipped.push({
          number,
          reason:
            error instanceof GitHubError
              ? txKnown(error.message, GITHUB_FAILURE_KEYS)
              : tx("GitHub could not be reached"),
        });
        continue;
      }
      if (issue.pull_request !== undefined) {
        skipped.push({ number, reason: tx("This is a pull request, not an issue") });
        continue;
      }
      const labels = labelsOf(issue);
      const prompt = issuePrompt({
        repo,
        number,
        title: issue.title,
        body: issue.body ?? null,
        author: issue.user?.login ?? null,
        labels,
        url: issue.html_url,
      });
      const targets = context
        ? context.resolveTargets([], `${issue.title}\n${issue.body ?? ""}`).inferred
        : [];
      const task = await this.deps.tasks.create(
        {
          projectId,
          workspaceId: input.workspaceId ?? null,
          title: issueTitle(issue.title),
          prompt,
          kind: kindFromLabels(labels),
          priority: 0,
          targetPaths: targets.slice(0, MAX_INFERRED_TARGETS),
          canWait: false,
        },
        { repo, number, url: issue.html_url, labels },
      );
      items.push(task);
    }
    if (items.length > 0)
      this.deps.logger.info({ projectId, repo, imported: items.length }, "Imported GitHub issues");
    return { items, skipped };
  }

  private async imported(
    projectId: string,
    repo: string,
    numbers: readonly number[],
  ): Promise<Map<number, string>> {
    if (numbers.length === 0) return new Map();
    const tasks = await this.deps.prisma.task.findMany({
      where: { projectId, issueRepo: repo, issueNumber: { in: [...numbers] } },
      select: { id: true, issueNumber: true },
      orderBy: { createdAt: "asc" },
    });
    return new Map(
      tasks.flatMap((task) => (task.issueNumber === null ? [] : [[task.issueNumber, task.id]])),
    );
  }
}
