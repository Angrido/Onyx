import type { IdeationDto, InsightListResponse, ProjectDetailDto } from "@onyx/contracts";
import Link from "next/link";
import { IdeationPanel } from "@/components/insights/ideation-panel";
import { InsightsPanel } from "@/components/insights/insights-panel";
import { PageHeader } from "@/components/layout/page-header";
import { serverFetch } from "@/lib/api/server";

export const metadata = { title: "Insights" };

export default async function ProjectInsightsPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const [project, insights, ideation] = await Promise.all([
    serverFetch<ProjectDetailDto>(`/api/projects/${projectId}`),
    serverFetch<InsightListResponse>(`/api/projects/${projectId}/insights`),
    serverFetch<IdeationDto>(`/api/projects/${projectId}/ideation`),
  ]);
  return (
    <>
      <PageHeader
        eyebrow={
          <Link href={`/projects/${project.id}`} className="hover:text-foreground">
            ← {project.name}
          </Link>
        }
        title="Insights"
        description="Questions about the code and a security and performance review, model last."
      />
      <InsightsPanel projectId={project.id} initial={insights} />
      <IdeationPanel projectId={project.id} workspaces={project.workspaces} initial={ideation} />
    </>
  );
}
