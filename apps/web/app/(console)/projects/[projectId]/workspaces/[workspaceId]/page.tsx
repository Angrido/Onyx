import type {
  CatalogResponse,
  ProjectDetailDto,
  SessionListResponse,
  TerminalListResponse,
} from "@onyx/contracts";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { HelpTip } from "@/components/ui/help-tip";
import { WorkspaceConsole } from "@/components/workspaces/workspace-console";
import { serverFetch } from "@/lib/api/server";
import { DOMAIN_LABELS } from "@/lib/domains";
import { getT } from "@/lib/i18n/server";

export default async function WorkspacePage({
  params,
}: {
  params: Promise<{ projectId: string; workspaceId: string }>;
}) {
  const { projectId, workspaceId } = await params;
  const t = await getT();
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
        title={workspace.name}
        description={
          <>
            {t("Workspace for the {domain} area", {
              domain: t(DOMAIN_LABELS[workspace.domain]),
            })}{" "}
            <HelpTip term="workspace" /> ·{" "}
            <span className="break-all font-mono text-xs">{workspace.pathGlobs.join(", ")}</span>
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
