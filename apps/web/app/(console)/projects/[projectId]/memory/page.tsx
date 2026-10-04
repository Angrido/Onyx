import type { ProjectDetailDto, ProjectMemoryDto } from "@onyx/contracts";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { MemoryPanel } from "@/components/memory/memory-panel";
import { serverFetch } from "@/lib/api/server";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Project memory") };
}

export default async function ProjectMemoryPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const t = await getT();
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
        title={t("Project memory")}
        description={t(
          "Stable facts from earlier runs, each with its source. You decide what stays.",
        )}
      />
      <MemoryPanel initial={memory} />
    </>
  );
}
