import type { ProjectDetailDto, SurgeonStateDto } from "@onyx/contracts";
import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { SurgeonWorkbench } from "@/components/surgeon/surgeon-workbench";
import { serverFetch } from "@/lib/api/server";

export default async function ProjectSurgeonPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const [project, state] = await Promise.all([
    serverFetch<ProjectDetailDto>(`/api/projects/${projectId}`),
    serverFetch<SurgeonStateDto>(`/api/projects/${projectId}/surgeon`),
  ]);

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href={`/projects/${project.id}`} className="hover:text-foreground">
            ← {project.name}
          </Link>
        }
        title="Context Surgeon"
        description="Choose what agents can see. Excluded files become Claude Code deny rules and are blocked at runtime by a PreToolUse guard on Read, Grep, Glob and Bash."
      />
      <SurgeonWorkbench
        projectId={project.id}
        workspaces={project.workspaces.map(({ id, name, domain }) => ({ id, name, domain }))}
        initial={state}
      />
    </>
  );
}
