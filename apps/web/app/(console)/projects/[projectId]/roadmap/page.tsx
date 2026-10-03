import type { CatalogResponse, ProjectBoard, ProjectDetailDto } from "@onyx/contracts";
import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { RoadmapBoard } from "@/components/roadmap/roadmap-board";
import { serverFetch } from "@/lib/api/server";

export const metadata = { title: "Roadmap" };

export default async function RoadmapPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const [project, board, catalog] = await Promise.all([
    serverFetch<ProjectDetailDto>(`/api/projects/${projectId}`),
    serverFetch<ProjectBoard>(`/api/projects/${projectId}/board`),
    serverFetch<CatalogResponse>("/api/catalog"),
  ]);
  return (
    <>
      <PageHeader
        eyebrow={
          <Link href={`/projects/${project.id}`} className="hover:text-foreground">
            ← {project.name}
          </Link>
        }
        title="Roadmap"
        description="Claude studies the project and suggests what to do next. Move the ideas you want to To do, start them, and publish the result on a branch."
      />
      <RoadmapBoard
        projectId={project.id}
        initial={board}
        workspaces={project.workspaces}
        catalog={catalog}
      />
    </>
  );
}
