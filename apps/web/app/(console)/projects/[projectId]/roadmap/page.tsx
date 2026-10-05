import type {
  CatalogResponse,
  GitHubAccountDto,
  ProjectBoard,
  ProjectDetailDto,
} from "@onyx/contracts";
import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { GitPanel } from "@/components/git/git-panel";
import { RoadmapBoard } from "@/components/roadmap/roadmap-board";
import { serverFetch } from "@/lib/api/server";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Roadmap") };
}

export default async function RoadmapPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const t = await getT();
  const [project, board, catalog, github] = await Promise.all([
    serverFetch<ProjectDetailDto>(`/api/projects/${projectId}`),
    serverFetch<ProjectBoard>(`/api/projects/${projectId}/board`),
    serverFetch<CatalogResponse>("/api/catalog"),
    serverFetch<GitHubAccountDto>("/api/github/account"),
  ]);
  return (
    <>
      <PageHeader
        title={t("Roadmap")}
        description={t(
          "Claude studies the project and suggests what to do next. Move the ideas you want to To do, start them, and publish the result on a branch.",
        )}
      />
      <RoadmapBoard
        projectId={project.id}
        initial={board}
        workspaces={project.workspaces}
        catalog={catalog}
        gitPanel={<GitPanel projectId={project.id} githubConnected={github.connected} />}
      />
    </>
  );
}
