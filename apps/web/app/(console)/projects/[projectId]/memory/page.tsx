import type { ProjectMemoryDto } from "@onyx/contracts";
import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { HelpTip } from "@/components/ui/help-tip";
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
  const memory = await serverFetch<ProjectMemoryDto>(`/api/projects/${projectId}/memory`);
  return (
    <>
      <PageHeader
        title={t("Project memory")}
        description={
          <>
            {t("Stable facts from earlier runs, each with its source. You decide what stays.")}{" "}
            <HelpTip term="memory" />
          </>
        }
      />
      <MemoryPanel initial={memory} />
    </>
  );
}
