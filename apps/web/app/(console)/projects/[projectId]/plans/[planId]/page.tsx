import type { OrchestrationDto, ProjectDetailDto } from "@onyx/contracts";
import type { Metadata } from "next";
import Link from "next/link";
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
        eyebrow={
          <Link href={`/projects/${project.id}`} className="hover:text-foreground">
            ← {project.name}
          </Link>
        }
        title={t("Feature plan")}
        description={plan.goal}
      />
      <PlanView initial={plan} />
    </>
  );
}
