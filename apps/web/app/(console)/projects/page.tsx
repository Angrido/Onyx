import type { ProjectListResponse } from "@onyx/contracts";
import { PageHeader } from "@/components/layout/page-header";
import {
  CreateProjectDialog,
  type ProjectSource,
} from "@/components/projects/create-project-dialog";
import { ProjectGrid } from "@/components/projects/project-grid";
import { serverFetch } from "@/lib/api/server";

export const metadata = { title: "Projects" };

function sourceOf(value: string | string[] | undefined): ProjectSource | null {
  return value === "github" || value === "local" ? value : null;
}

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [projects, params] = await Promise.all([
    serverFetch<ProjectListResponse>("/api/projects"),
    searchParams,
  ]);
  const requested = sourceOf(params["new"]);
  const suggestedRoot = process.env.ONYX_PROJECTS_DIR;
  const rootProps = suggestedRoot ? { suggestedRoot: `${suggestedRoot}/` } : {};
  const empty = projects.items.length === 0;
  const header = (
    <CreateProjectDialog
      {...rootProps}
      defaultOpen={requested !== null && !empty}
      defaultSource={requested ?? "github"}
    />
  );
  const emptyAction = (
    <CreateProjectDialog
      {...rootProps}
      defaultOpen={requested !== null && empty}
      defaultSource={requested ?? "github"}
    />
  );
  return (
    <>
      <PageHeader
        eyebrow="Workspace"
        title="Projects"
        description="Repositories Onyx can orchestrate. Each project is split into domain workspaces with their own sessions."
        actions={header}
      />
      <ProjectGrid initial={projects.items} emptyAction={emptyAction} />
    </>
  );
}
