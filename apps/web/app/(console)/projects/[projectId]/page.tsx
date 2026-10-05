import type {
  ApprovalListResponse,
  CatalogResponse,
  GitHubAccountDto,
  IndexStatusDto,
  OrchestrationListResponse,
  ProjectDetailDto,
  ProjectHealthReport,
  TaskListResponse,
} from "@onyx/contracts";
import type { Metadata } from "next";
import { GitPanel } from "@/components/git/git-panel";
import { PageHeader } from "@/components/layout/page-header";
import { PlanFeatureDialog } from "@/components/orchestration/plan-feature-dialog";
import { PlanList } from "@/components/orchestration/plan-list";
import { AllowedCommands } from "@/components/projects/allowed-commands";
import { IndexCard } from "@/components/projects/index-card";
import { ProjectWork } from "@/components/projects/project-work";
import { WorkspaceGrid } from "@/components/projects/workspace-grid";
import { ProjectHealthCard } from "@/components/system/health-checks";
import { CreateTaskDialog } from "@/components/tasks/create-task-dialog";
import { HelpTip } from "@/components/ui/help-tip";
import { serverFetch } from "@/lib/api/server";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ projectId: string }>;
}): Promise<Metadata> {
  const { projectId } = await params;
  const project = await serverFetch<ProjectDetailDto>(`/api/projects/${projectId}`);
  return { title: project.name };
}

export default async function ProjectPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const t = await getT();
  const [project, tasks, catalog, index, github, plans, health, approvals] = await Promise.all([
    serverFetch<ProjectDetailDto>(`/api/projects/${projectId}`),
    serverFetch<TaskListResponse>(`/api/tasks?projectId=${encodeURIComponent(projectId)}`),
    serverFetch<CatalogResponse>("/api/catalog"),
    serverFetch<IndexStatusDto>(`/api/projects/${projectId}/index`),
    serverFetch<GitHubAccountDto>("/api/github/account"),
    serverFetch<OrchestrationListResponse>(`/api/projects/${projectId}/orchestrations`),
    serverFetch<ProjectHealthReport>(`/api/projects/${projectId}/health`),
    serverFetch<ApprovalListResponse>("/api/approvals?status=PENDING&limit=200"),
  ]);
  const createTask = (
    <CreateTaskDialog projectId={project.id} workspaces={project.workspaces} catalog={catalog} />
  );

  return (
    <>
      <PageHeader
        title={project.name}
        description={<span className="break-all font-mono text-xs">{project.rootPath}</span>}
        actions={
          <>
            <PlanFeatureDialog projectId={project.id} catalog={catalog} />
            {createTask}
          </>
        }
      />
      <ProjectWork
        projectId={project.id}
        initialTasks={tasks.items}
        initialPlans={plans.items}
        initialApprovals={
          approvals.items.filter((approval) => approval.projectId === project.id).length
        }
        health={health}
        createTask={createTask}
      />
      <PlanList projectId={project.id} initial={plans.items} />
      <section className="space-y-3" aria-labelledby="project-workspaces-heading">
        <div className="space-y-1">
          <h2
            id="project-workspaces-heading"
            className="flex items-center gap-1 text-sm font-semibold tracking-tight"
          >
            {t("Workspaces")}
            <HelpTip term="workspace" />
          </h2>
          <p className="flex flex-wrap items-center gap-x-1 text-xs text-muted-foreground">
            {t(
              "Each area of the project has its own conversations with Claude. The badge says what happens when an agent needs files outside its area.",
            )}
            <HelpTip term="fence" />
          </p>
        </div>
        <WorkspaceGrid workspaces={project.workspaces} />
      </section>
      <section
        className="space-y-4"
        aria-labelledby="project-setup-heading"
        data-testid="project-setup"
      >
        <div className="space-y-1">
          <h2 id="project-setup-heading" className="text-sm font-semibold tracking-tight">
            {t("Configuration")}
          </h2>
          <p className="text-xs text-muted-foreground">
            {t(
              "What agents may run, what Onyx knows about the code, the branch and the health of the project.",
            )}
          </p>
        </div>
        <AllowedCommands
          projectId={project.id}
          initial={project.allowedTools}
          grants={project.commandGrants}
        />
        <IndexCard projectId={project.id} initial={index} />
        <GitPanel projectId={project.id} githubConnected={github.connected} />
        <ProjectHealthCard initial={health} />
      </section>
    </>
  );
}
