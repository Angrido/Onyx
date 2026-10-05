import type { QueueDto, TerminalListResponse, WorkspaceRefListResponse } from "@onyx/contracts";
import type { Metadata } from "next";
import { AgentGrid } from "@/components/agents/agent-grid";
import { PageHeader } from "@/components/layout/page-header";
import { HelpTip } from "@/components/ui/help-tip";
import { serverFetch } from "@/lib/api/server";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Agents") };
}

export default async function AgentsPage() {
  const t = await getT();
  const [workspaces, terminals, queue] = await Promise.all([
    serverFetch<WorkspaceRefListResponse>("/api/workspaces"),
    serverFetch<TerminalListResponse>("/api/terminals"),
    serverFetch<QueueDto>("/api/queue"),
  ]);
  return (
    <>
      <PageHeader
        eyebrow={t("Work")}
        title={t("Agents")}
        description={
          <>
            {t(
              "Live runs and interactive terminals side by side. Panels out of view pause and catch up when you scroll back.",
            )}
            <HelpTip term="workspace" className="ml-1" />
          </>
        }
      />
      <AgentGrid workspaces={workspaces.items} terminals={terminals.items} initialQueue={queue} />
    </>
  );
}
