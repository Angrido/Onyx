import type { ProjectListResponse } from "@onyx/contracts";
import { PageHeader } from "@/components/layout/page-header";
import { CreateProjectDialog } from "@/components/projects/create-project-dialog";
import { ProjectGrid } from "@/components/projects/project-grid";
import { serverFetch } from "@/lib/api/server";

export const metadata = { title: "Projects" };

export default async function ProjectsPage() {
  const projects = await serverFetch<ProjectListResponse>("/api/projects");
  const suggestedRoot = process.env.ONYX_PROJECTS_DIR;
  const dialog = (
    <CreateProjectDialog {...(suggestedRoot ? { suggestedRoot: `${suggestedRoot}/` } : {})} />
  );
  return (
    <>
      <PageHeader
        eyebrow="Workspace"
        title="Projects"
        description="Repositories Onyx can orchestrate. Each project is split into domain workspaces with their own sessions."
        actions={dialog}
      />
      <ProjectGrid initial={projects.items} emptyAction={dialog} />
    </>
  );
}
