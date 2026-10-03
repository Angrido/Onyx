import type {
  CatalogResponse,
  IndexStatusDto,
  ProjectDetailDto,
  TaskListResponse,
} from "@onyx/contracts";
import { Map as MapIcon } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { IndexCard } from "@/components/projects/index-card";
import { WorkspaceGrid } from "@/components/projects/workspace-grid";
import { CreateTaskDialog } from "@/components/tasks/create-task-dialog";
import { TaskList } from "@/components/tasks/task-list";
import { Button } from "@/components/ui/button";
import { serverFetch } from "@/lib/api/server";

export default async function ProjectPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const [project, tasks, catalog, index] = await Promise.all([
    serverFetch<ProjectDetailDto>(`/api/projects/${projectId}`),
    serverFetch<TaskListResponse>(`/api/tasks?projectId=${encodeURIComponent(projectId)}`),
    serverFetch<CatalogResponse>("/api/catalog"),
    serverFetch<IndexStatusDto>(`/api/projects/${projectId}/index`),
  ]);
  const createTask = (
    <CreateTaskDialog projectId={project.id} workspaces={project.workspaces} catalog={catalog} />
  );
  const actions = (
    <>
      <Button asChild variant="secondary">
        <Link href={`/projects/${project.id}/roadmap`}>
          <MapIcon />
          Roadmap
        </Link>
      </Button>
      {createTask}
    </>
  );

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/projects" className="hover:text-foreground">
            ← Projects
          </Link>
        }
        title={project.name}
        description={<span className="font-mono text-xs">{project.rootPath}</span>}
        actions={actions}
      />
      <IndexCard projectId={project.id} initial={index} />
      <section className="space-y-3">
        <h2 className="text-sm font-semibold tracking-tight">Workspaces</h2>
        <WorkspaceGrid workspaces={project.workspaces} />
      </section>
      <section className="space-y-3">
        <h2 className="text-sm font-semibold tracking-tight">Tasks</h2>
        <TaskList initial={tasks.items} projectId={project.id} emptyAction={createTask} />
      </section>
    </>
  );
}
