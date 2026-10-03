"use client";

import type {
  CatalogResponse,
  SessionDto,
  SessionListResponse,
  TerminalDto,
  TerminalListResponse,
  WorkspaceDto,
} from "@onyx/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { SessionChain } from "@/components/workspaces/session-chain";
import { TerminalPanel } from "@/components/workspaces/terminal-panel";
import { WorkspaceSettings } from "@/components/workspaces/workspace-settings";
import { api } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/keys";

export function WorkspaceConsole({
  workspace: initialWorkspace,
  sessions: initialSessions,
  terminals,
  catalog,
}: {
  workspace: WorkspaceDto;
  sessions: SessionDto[];
  terminals: TerminalDto[];
  catalog: CatalogResponse;
}) {
  const queryClient = useQueryClient();
  const [workspace, setWorkspace] = useState(initialWorkspace);
  const sessions = useQuery({
    queryKey: queryKeys.sessions(workspace.id),
    queryFn: () => api.get<SessionListResponse>(`/api/workspaces/${workspace.id}/sessions`),
    initialData: { items: initialSessions },
    select: (data) => data.items,
    refetchInterval: 10_000,
  });
  const running = useQuery({
    queryKey: queryKeys.terminals(workspace.id),
    queryFn: () =>
      api.get<TerminalListResponse>(
        `/api/terminals?workspaceId=${encodeURIComponent(workspace.id)}`,
      ),
    initialData: { items: terminals },
    select: (data) => data.items.some((item) => item.state === "running"),
  });
  const refreshSessions = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.sessions(workspace.id) });
  }, [queryClient, workspace.id]);

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
      <TerminalPanel
        workspaceId={workspace.id}
        workspaceName={workspace.name}
        initial={terminals}
        catalog={catalog}
        onSessionChange={refreshSessions}
      />
      <div className="space-y-6">
        <SessionChain
          workspaceId={workspace.id}
          sessions={sessions.data}
          busy={running.data}
          onChange={refreshSessions}
        />
        <WorkspaceSettings workspace={workspace} onSaved={setWorkspace} />
      </div>
    </div>
  );
}
