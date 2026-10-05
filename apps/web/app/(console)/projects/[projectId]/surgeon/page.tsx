import type { ProjectDetailDto, SurgeonStateDto } from "@onyx/contracts";
import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { HelpTip } from "@/components/ui/help-tip";
import { SurgeonWorkbench } from "@/components/surgeon/surgeon-workbench";
import { serverFetch } from "@/lib/api/server";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Context Surgeon") };
}

export default async function ProjectSurgeonPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const t = await getT();
  const [project, state] = await Promise.all([
    serverFetch<ProjectDetailDto>(`/api/projects/${projectId}`),
    serverFetch<SurgeonStateDto>(`/api/projects/${projectId}/surgeon`),
  ]);

  return (
    <>
      <PageHeader
        title={t("Context Surgeon")}
        description={
          <>
            {t(
              "Choose which files agents can see. Onyx blocks the excluded files on every read, search and command.",
            )}{" "}
            <HelpTip term="surgeon" />
          </>
        }
      />
      <SurgeonWorkbench
        projectId={project.id}
        workspaces={project.workspaces.map(({ id, name, domain }) => ({ id, name, domain }))}
        initial={state}
      />
    </>
  );
}
