import type { QueueDto, TerminalListResponse, WorkspaceRefListResponse } from "@onyx/contracts";
import { AgentGrid } from "@/components/agents/agent-grid";
import { PageHeader } from "@/components/layout/page-header";
import { serverFetch } from "@/lib/api/server";

export const metadata = { title: "Agent grid" };

export default async function AgentsPage() {
  const [workspaces, terminals, queue] = await Promise.all([
    serverFetch<WorkspaceRefListResponse>("/api/workspaces"),
    serverFetch<TerminalListResponse>("/api/terminals"),
    serverFetch<QueueDto>("/api/queue"),
  ]);
  return (
    <>
      <PageHeader
        eyebrow="Agents"
        title="Agent grid"
        description="Live runs and interactive terminals side by side. Panels out of view pause and catch up when you scroll back."
      />
      <AgentGrid workspaces={workspaces.items} terminals={terminals.items} initialQueue={queue} />
    </>
  );
}
