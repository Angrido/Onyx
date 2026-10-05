import type { ProjectDetailDto } from "@onyx/contracts";
import type { ReactNode } from "react";
import { ProjectNav } from "@/components/projects/project-nav";
import { serverFetch } from "@/lib/api/server";

export default async function ProjectLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const project = await serverFetch<ProjectDetailDto>(`/api/projects/${projectId}`);
  return (
    <>
      <ProjectNav projectId={project.id} name={project.name} />
      {children}
    </>
  );
}
