import type {
  CatalogResponse,
  GitHubAccountDto,
  IndexStatusDto,
  OrchestrationListResponse,
  ProjectDetailDto,
  ProjectHealthReport,
  TaskListResponse,
} from "@onyx/contracts";
import { Brain, Lightbulb, Map as MapIcon } from "lucide-react";
import { GitHubMark } from "@/components/ui/github-mark";
import Link from "next/link";
import { GitPanel } from "@/components/git/git-panel";
import { PageHeader } from "@/components/layout/page-header";
import { PlanFeatureDialog } from "@/components/orchestration/plan-feature-dialog";
import { PlanList } from "@/components/orchestration/plan-list";
import { AllowedCommands } from "@/components/projects/allowed-commands";
import { IndexCard } from "@/components/projects/index-card";
import { ProjectHealthCard } from "@/components/system/health-checks";
import { WorkspaceGrid } from "@/components/projects/workspace-grid";
import { CreateTaskDialog } from "@/components/tasks/create-task-dialog";
import { TaskList } from "@/components/tasks/task-list";
import { Button } from "@/components/ui/button";
import { serverFetch } from "@/lib/api/server";
import { getT } from "@/lib/i18n/server";

export default async function ProjectPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const t = await getT();
  const [project, tasks, catalog, index, github, plans, health] = await Promise.all([
    serverFetch<ProjectDetailDto>(`/api/projects/${projectId}`),
    serverFetch<TaskListResponse>(`/api/tasks?projectId=${encodeURIComponent(projectId)}`),
    serverFetch<CatalogResponse>("/api/catalog"),
    serverFetch<IndexStatusDto>(`/api/projects/${projectId}/index`),
    serverFetch<GitHubAccountDto>("/api/github/account"),
    serverFetch<OrchestrationListResponse>(`/api/projects/${projectId}/orchestrations`),
    serverFetch<ProjectHealthReport>(`/api/projects/${projectId}/health`),
  ]);
  const createTask = (
    <CreateTaskDialog projectId={project.id} workspaces={project.workspaces} catalog={catalog} />
  );
  const actions = (
    <>
      <Button asChild variant="secondary">
        <Link href={`/projects/${project.id}/memory`}>
          <Brain />
          {t("Memory")}
        </Link>
      </Button>
      <Button asChild variant="secondary">
        <Link href={`/projects/${project.id}/insights`}>
          <Lightbulb />
          {t("Insights")}
        </Link>
      </Button>
      <Button asChild variant="secondary">
        <Link href={`/projects/${project.id}/github`}>
          <GitHubMark />
          GitHub
        </Link>
      </Button>
      <Button asChild variant="secondary">
        <Link href={`/projects/${project.id}/roadmap`}>
          <MapIcon />
          {t("Roadmap")}
        </Link>
      </Button>
      <PlanFeatureDialog projectId={project.id} catalog={catalog} />
      {createTask}
    </>
  );

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/projects" className="hover:text-foreground">
            ← {t("Projects")}
          </Link>
        }
        title={project.name}
        description={<span className="font-mono text-xs">{project.rootPath}</span>}
        actions={actions}
      />
      <ProjectHealthCard initial={health} />
      <IndexCard projectId={project.id} initial={index} />
      <GitPanel projectId={project.id} githubConnected={github.connected} />
      <PlanList projectId={project.id} initial={plans.items} />
      <section className="space-y-3">
        <h2 className="text-sm font-semibold tracking-tight">{t("Workspaces")}</h2>
        <WorkspaceGrid workspaces={project.workspaces} />
      </section>
      <section className="space-y-3">
        <h2 className="text-sm font-semibold tracking-tight">{t("Tasks")}</h2>
        <TaskList initial={tasks.items} projectId={project.id} emptyAction={createTask} />
      </section>
      <AllowedCommands
        projectId={project.id}
        initial={project.allowedTools}
        grants={project.commandGrants}
      />
    </>
  );
}
