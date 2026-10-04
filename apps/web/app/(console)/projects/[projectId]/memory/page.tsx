import type { ProjectDetailDto, ProjectMemoryDto } from "@onyx/contracts";
import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { MemoryPanel } from "@/components/memory/memory-panel";
import { serverFetch } from "@/lib/api/server";

export const metadata = { title: "Project memory" };

export default async function ProjectMemoryPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const [project, memory] = await Promise.all([
    serverFetch<ProjectDetailDto>(`/api/projects/${projectId}`),
    serverFetch<ProjectMemoryDto>(`/api/projects/${projectId}/memory`),
  ]);
  return (
    <>
      <PageHeader
        eyebrow={
          <Link href={`/projects/${project.id}`} className="hover:text-foreground">
            ← {project.name}
          </Link>
        }
        title="Project memory"
        description="Stable facts from earlier runs, each with its source. You decide what stays."
      />
      <MemoryPanel initial={memory} />
    </>
  );
}
