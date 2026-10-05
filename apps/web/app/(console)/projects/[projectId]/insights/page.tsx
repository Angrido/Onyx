import type { IdeationDto, InsightListResponse, ProjectDetailDto } from "@onyx/contracts";
import type { Metadata } from "next";
import { IdeationPanel } from "@/components/insights/ideation-panel";
import { InsightsPanel } from "@/components/insights/insights-panel";
import { PageHeader } from "@/components/layout/page-header";
import { HelpTip } from "@/components/ui/help-tip";
import { serverFetch } from "@/lib/api/server";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Insights") };
}

export default async function ProjectInsightsPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const t = await getT();
  const [project, insights, ideation] = await Promise.all([
    serverFetch<ProjectDetailDto>(`/api/projects/${projectId}`),
    serverFetch<InsightListResponse>(`/api/projects/${projectId}/insights`),
    serverFetch<IdeationDto>(`/api/projects/${projectId}/ideation`),
  ]);
  return (
    <>
      <PageHeader
        title={t("Insights")}
        description={
          <>
            {t(
              "Ask questions about the code and check it for security and performance problems. Onyx answers from the index when it can and calls Claude only when needed.",
            )}{" "}
            <HelpTip term="insights" />
          </>
        }
      />
      <InsightsPanel projectId={project.id} initial={insights} />
      <IdeationPanel projectId={project.id} workspaces={project.workspaces} initial={ideation} />
    </>
  );
}
