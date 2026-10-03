"use client";

import type { Domain, WorkspaceDto } from "@onyx/contracts";
import { useMutation } from "@tanstack/react-query";
import { Database, Layers, Monitor, RotateCcw, Server, Wrench } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { api, errorMessage } from "@/lib/api/client";
import { shortId } from "@/lib/format";

const DOMAIN_ICONS: Record<Domain, typeof Monitor> = {
  FRONTEND: Monitor,
  BACKEND: Server,
  DATABASE: Database,
  INFRA: Wrench,
  CUSTOM: Layers,
};

function WorkspaceCard({ workspace }: { workspace: WorkspaceDto }) {
  const router = useRouter();
  const Icon = DOMAIN_ICONS[workspace.domain];
  const reset = useMutation({
    mutationFn: () => api.post<WorkspaceDto>(`/api/workspaces/${workspace.id}/reset`),
    onSuccess: () => {
      toast.success(`${workspace.name}: context reset`);
      router.refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon className="size-4 text-muted-foreground" />
          <span className="text-sm font-medium">{workspace.name}</span>
        </div>
        <Badge>{workspace.resetStrategy.toLowerCase()}</Badge>
      </div>
      <div className="flex flex-wrap gap-1">
        {workspace.pathGlobs.slice(0, 3).map((glob) => (
          <code
            key={glob}
            className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
          >
            {glob}
          </code>
        ))}
        {workspace.pathGlobs.length > 3 ? (
          <span className="text-[10px] text-muted-foreground">
            +{workspace.pathGlobs.length - 3}
          </span>
        ) : null}
      </div>
      <div className="mt-auto flex items-center justify-between text-xs text-muted-foreground">
        <span>
          Session{" "}
          <span className="font-mono text-foreground">
            {workspace.activeSessionId ? shortId(workspace.activeSessionId) : "none"}
          </span>
        </span>
        <Button
          variant="ghost"
          size="sm"
          disabled={!workspace.activeSessionId || reset.isPending}
          onClick={() => reset.mutate()}
          title="Start the next run with a clean context"
        >
          <RotateCcw />
          Reset
        </Button>
      </div>
    </Card>
  );
}

export function WorkspaceGrid({ workspaces }: { workspaces: WorkspaceDto[] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {workspaces.map((workspace) => (
        <WorkspaceCard key={workspace.id} workspace={workspace} />
      ))}
    </div>
  );
}
