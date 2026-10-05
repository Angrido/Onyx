"use client";

import type { Domain, ResetStrategy, WorkspaceDto } from "@onyx/contracts";
import { useMutation } from "@tanstack/react-query";
import { Database, Layers, Monitor, RotateCcw, Server, SquareTerminal, Wrench } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { api, errorMessage } from "@/lib/api/client";
import { shortId } from "@/lib/format";
import { msg } from "@/lib/i18n/core";
import { useT } from "@/lib/i18n/client";
import { RESET_STRATEGY_LABELS } from "@/lib/sessions";

export const FENCE_LABELS: Record<ResetStrategy, string> = {
  HARD: msg("Rigid fence"),
  HANDOFF: msg("Exit with handoff"),
  SOFT: msg("Continuous session"),
};

const DOMAIN_ICONS: Record<Domain, typeof Monitor> = {
  FRONTEND: Monitor,
  BACKEND: Server,
  DATABASE: Database,
  INFRA: Wrench,
  CUSTOM: Layers,
};

function WorkspaceCard({ workspace }: { workspace: WorkspaceDto }) {
  const t = useT();
  const router = useRouter();
  const Icon = DOMAIN_ICONS[workspace.domain];
  const reset = useMutation({
    mutationFn: () => api.post<WorkspaceDto>(`/api/workspaces/${workspace.id}/reset`),
    onSuccess: () => {
      toast.success(t("{name}: context reset", { name: workspace.name }));
      router.refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <Link
          href={`/projects/${workspace.projectId}/workspaces/${workspace.id}`}
          className="flex min-w-0 items-center gap-2 hover:text-primary"
        >
          <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="truncate text-sm font-medium">{workspace.name}</span>
        </Link>
        <Badge title={t(RESET_STRATEGY_LABELS[workspace.resetStrategy].hint)}>
          {t(FENCE_LABELS[workspace.resetStrategy])}
        </Badge>
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
          {t("Session")}{" "}
          <span className="font-mono text-foreground">
            {workspace.activeSessionId ? shortId(workspace.activeSessionId) : t("none")}
          </span>
        </span>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            disabled={!workspace.activeSessionId || reset.isPending}
            onClick={() => reset.mutate()}
            title={t("Start the next run in a new session with a handoff note")}
          >
            <RotateCcw />
            {t("Reset")}
          </Button>
          <Button variant="secondary" size="sm" asChild>
            <Link href={`/projects/${workspace.projectId}/workspaces/${workspace.id}`}>
              <SquareTerminal />
              {t("Open")}
            </Link>
          </Button>
        </div>
      </div>
    </Card>
  );
}

export function WorkspaceGrid({ workspaces }: { workspaces: WorkspaceDto[] }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {workspaces.map((workspace) => (
        <WorkspaceCard key={workspace.id} workspace={workspace} />
      ))}
    </div>
  );
}
