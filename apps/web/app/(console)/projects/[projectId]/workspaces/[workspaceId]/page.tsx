import type {
  CatalogResponse,
  ProjectDetailDto,
  SessionListResponse,
  TerminalListResponse,
} from "@onyx/contracts";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { WorkspaceConsole } from "@/components/workspaces/workspace-console";
import { serverFetch } from "@/lib/api/server";
import { DOMAIN_LABELS } from "@/lib/domains";

export default async function WorkspacePage({
  params,
}: {
  params: Promise<{ projectId: string; workspaceId: string }>;
}) {
  const { projectId, workspaceId } = await params;
  const [project, sessions, terminals, catalog] = await Promise.all([
    serverFetch<ProjectDetailDto>(`/api/projects/${projectId}`),
    serverFetch<SessionListResponse>(`/api/workspaces/${workspaceId}/sessions`),
    serverFetch<TerminalListResponse>(
      `/api/terminals?workspaceId=${encodeURIComponent(workspaceId)}`,
    ),
    serverFetch<CatalogResponse>("/api/catalog"),
  ]);
  const workspace = project.workspaces.find((candidate) => candidate.id === workspaceId);
  if (!workspace) notFound();

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href={`/projects/${project.id}`} className="hover:text-foreground">
            ← {project.name}
          </Link>
        }
        title={workspace.name}
        description={
          <>
            {DOMAIN_LABELS[workspace.domain]} compartment ·{" "}
            <span className="font-mono text-xs">{workspace.pathGlobs.join(", ")}</span>
          </>
        }
      />
      <WorkspaceConsole
        workspace={workspace}
        sessions={sessions.items}
        terminals={terminals.items}
        catalog={catalog}
      />
    </>
  );
}
