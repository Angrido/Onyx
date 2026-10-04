import type {
  ChangelogPreviewDto,
  GitHubIssueListResponse,
  GitStatusDto,
  PullRequestDraftDto,
  OrchestrationListResponse,
  ProjectDetailDto,
  PullRequestListResponse,
  TaskListResponse,
} from "@onyx/contracts";
import Link from "next/link";
import { ChangelogCard } from "@/components/github/changelog-card";
import { IssuesCard } from "@/components/github/issues-card";
import { PullRequestsCard } from "@/components/github/pull-requests-card";
import { PageHeader } from "@/components/layout/page-header";
import { serverFetch } from "@/lib/api/server";

export const metadata = { title: "GitHub" };

export default async function ProjectGitHubPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ branch?: string }>;
}) {
  const { projectId } = await params;
  const { branch } = await searchParams;
  const [project, pulls, changelog, tasks, plans, git, issues] = await Promise.all([
    serverFetch<ProjectDetailDto>(`/api/projects/${projectId}`),
    serverFetch<PullRequestListResponse>(`/api/projects/${projectId}/github/pulls`),
    serverFetch<ChangelogPreviewDto>(`/api/projects/${projectId}/changelog`),
    serverFetch<TaskListResponse>(
      `/api/tasks?projectId=${encodeURIComponent(projectId)}&status=COMPLETED&limit=200`,
    ),
    serverFetch<OrchestrationListResponse>(`/api/projects/${projectId}/orchestrations`),
    serverFetch<GitStatusDto>(`/api/projects/${projectId}/git`),
    serverFetch<GitHubIssueListResponse>(`/api/projects/${projectId}/github/issues`).catch(
      () => null,
    ),
  ]);
  const branches = [
    ...new Set(
      [
        git.onDefaultBranch ? null : git.branch,
        ...tasks.items.map((task) => task.branchName),
        ...plans.items.map((plan) => plan.workBranch),
      ].filter(
        (name): name is string => typeof name === "string" && name !== project.defaultBranch,
      ),
    ),
  ];
  const initialBranch = branch ?? (git.onDefaultBranch ? "" : (git.branch ?? ""));
  const initialDraft =
    initialBranch && pulls.repo
      ? await serverFetch<PullRequestDraftDto>(
          `/api/projects/${projectId}/github/pulls/draft?branch=${encodeURIComponent(initialBranch)}`,
        ).catch(() => null)
      : null;

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href={`/projects/${project.id}`} className="hover:text-foreground">
            ← {project.name}
          </Link>
        }
        title="GitHub"
        description={
          pulls.repo ? (
            <span className="font-mono text-xs">{pulls.repo}</span>
          ) : (
            "Issues, pull requests and the changelog of the project."
          )
        }
      />
      <IssuesCard projectId={project.id} workspaces={project.workspaces} initial={issues} />
      <PullRequestsCard
        projectId={project.id}
        initial={pulls}
        branches={branches}
        initialBranch={initialBranch}
        initialDraft={initialDraft}
      />
      <ChangelogCard projectId={project.id} initial={changelog} />
    </>
  );
}
