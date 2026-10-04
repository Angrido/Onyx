import type { ProjectListResponse } from "@onyx/contracts";
import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import {
  CreateProjectDialog,
  type ProjectSource,
} from "@/components/projects/create-project-dialog";
import { ProjectGrid } from "@/components/projects/project-grid";
import { serverFetch } from "@/lib/api/server";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Projects") };
}

function sourceOf(value: string | string[] | undefined): ProjectSource | null {
  return value === "github" || value === "local" ? value : null;
}

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const t = await getT();
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
        eyebrow={t("Workspace")}
        title={t("Projects")}
        description={t(
          "Repositories Onyx can orchestrate. Each project is split into domain workspaces with their own sessions.",
        )}
        actions={header}
      />
      <ProjectGrid initial={projects.items} emptyAction={emptyAction} />
    </>
  );
}
