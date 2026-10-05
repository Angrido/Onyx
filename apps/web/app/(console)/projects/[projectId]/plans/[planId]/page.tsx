import type { OrchestrationDto, ProjectDetailDto } from "@onyx/contracts";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { PlanView } from "@/components/orchestration/plan-view";
import { serverFetch } from "@/lib/api/server";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Plan") };
}

export default async function PlanPage({
  params,
}: {
  params: Promise<{ projectId: string; planId: string }>;
}) {
  const { projectId, planId } = await params;
  const t = await getT();
  const [project, plan] = await Promise.all([
    serverFetch<ProjectDetailDto>(`/api/projects/${projectId}`),
    serverFetch<OrchestrationDto>(`/api/orchestrations/${planId}`),
  ]);
  if (plan.projectId !== project.id) notFound();
  return (
    <>
      <PageHeader
        title={t("Feature plan")}
        description={<span className="line-clamp-3 break-words">{plan.goal}</span>}
      />
      <PlanView initial={plan} />
    </>
  );
}
