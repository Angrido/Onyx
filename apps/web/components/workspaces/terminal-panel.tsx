"use client";

import type {
  CatalogResponse,
  TerminalDto,
  TerminalInjectionAction,
  TerminalListResponse,
} from "@onyx/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Eraser, Loader2, Minimize2, Play, Power, ScrollText, SquareTerminal } from "lucide-react";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { ModelSelect } from "@/components/tasks/model-select";
import { ModelBadge } from "@/components/tasks/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { TerminalView } from "@/components/workspaces/terminal-view";
import { api, errorMessage } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/keys";
import { formatTokens, shortId } from "@/lib/format";
import { END_REASON_LABELS } from "@/lib/sessions";
import { cn } from "@/lib/utils";

function ContextMeter({ used, max }: { used: number; max: number }) {
  const ratio = max > 0 ? Math.min(1, used / max) : 0;
  return (
    <div className="flex min-w-36 items-center gap-2 text-xs" title="Context of the last turn">
      <div className="h-1.5 flex-1 rounded-full bg-surface-2">
        <div
          className={cn(
            "h-full rounded-full transition-[width] duration-500",
            ratio >= 0.9 ? "bg-destructive" : ratio >= 0.7 ? "bg-warning" : "bg-success",
          )}
          style={{ width: `${ratio * 100}%` }}
        />
      </div>
      <span className="tabular text-muted-foreground">
        {formatTokens(used)} / {formatTokens(max)}
      </span>
    </div>
  );
}

function injectionLabel(terminal: TerminalDto): string | null {
  const pending = terminal.pending;
  if (!pending) return null;
  const reason = pending.reason ? ` · ${END_REASON_LABELS[pending.reason]}` : "";
  return `/${pending.action} queued${reason}`;
}

export function TerminalPanel({
  workspaceId,
  workspaceName,
  initial,
  catalog,
  onSessionChange,
}: {
  workspaceId: string;
  workspaceName: string;
  initial: TerminalDto[];
  catalog: CatalogResponse;
  onSessionChange: () => void;
}) {
  const queryClient = useQueryClient();
  const [model, setModel] = useState("");
  const [fresh, setFresh] = useState(false);
  const terminals = useQuery({
    queryKey: queryKeys.terminals(workspaceId),
    queryFn: () =>
      api.get<TerminalListResponse>(
        `/api/terminals?workspaceId=${encodeURIComponent(workspaceId)}`,
      ),
    initialData: { items: initial },
    select: (data) => data.items[0] ?? null,
  });
  const terminal = terminals.data;
  const running = terminal?.state === "running";

  const store = useCallback(
    (next: TerminalDto) => {
      const previous = queryClient.getQueryData<TerminalListResponse>(
        queryKeys.terminals(workspaceId),
      );
      const before = previous?.items.find((item) => item.id === next.id);
      queryClient.setQueryData<TerminalListResponse>(queryKeys.terminals(workspaceId), {
        items: [next, ...(previous?.items ?? []).filter((item) => item.id !== next.id)],
      });
      if (!before || before.sessionId !== next.sessionId || before.state !== next.state)
        onSessionChange();
    },
    [queryClient, workspaceId, onSessionChange],
  );

  const open = useMutation({
    mutationFn: () =>
      api.post<TerminalDto>(`/api/workspaces/${workspaceId}/terminal`, {
        ...(model ? { modelId: model } : {}),
        fresh,
      }),
    onSuccess: (created) => {
      store(created);
      setFresh(false);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const inject = useMutation({
    mutationFn: (input: { action: TerminalInjectionAction; handoff: boolean }) =>
      api.post<TerminalDto>(`/api/terminals/${terminal?.id ?? ""}/inject`, input),
    onSuccess: (updated) => {
      store(updated);
      toast.info(`/${updated.pending?.action ?? "command"} runs as soon as the terminal is idle`);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const close = useMutation({
    mutationFn: () => api.delete<TerminalDto>(`/api/terminals/${terminal?.id ?? ""}`),
    onSuccess: (closed) => store(closed),
    onError: (error) => toast.error(errorMessage(error)),
  });

  const pending = terminal ? injectionLabel(terminal) : null;

  return (
    <Card className="flex flex-col">
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-3">
        <div className="space-y-1.5">
          <CardTitle className="flex items-center gap-2">
            <SquareTerminal className="size-4 text-primary" />
            Interactive Claude Code
          </CardTitle>
          <CardDescription>
            Runs in the {workspaceName} compartment with its primer, read policy and write fence.
            Onyx injects <code className="font-mono">/compact</code> under context pressure and{" "}
            <code className="font-mono">/clear</code> with a handoff after a domain switch.
          </CardDescription>
        </div>
        {terminal ? (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <ModelBadge modelId={terminal.modelId} />
            <Badge tone={running ? "success" : "neutral"}>
              {running ? "running" : `exited ${terminal.exitCode ?? ""}`.trim()}
            </Badge>
            <span className="font-mono text-muted-foreground" title={terminal.sessionId}>
              session {shortId(terminal.sessionId)}
            </span>
          </div>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-3">
        {terminal ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <ContextMeter used={terminal.contextTokens} max={terminal.maxSessionTokens} />
              {pending ? (
                <Badge tone="warning" data-testid="terminal-pending">
                  <Loader2 className="size-3 animate-spin" />
                  {pending}
                </Badge>
              ) : terminal.lastInjection ? (
                <Badge>
                  last /{terminal.lastInjection.action}
                  {terminal.lastInjection.reason
                    ? ` · ${END_REASON_LABELS[terminal.lastInjection.reason]}`
                    : ""}
                </Badge>
              ) : null}
              <div className="ml-auto flex flex-wrap gap-1.5">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={!running || inject.isPending}
                  onClick={() => inject.mutate({ action: "compact", handoff: false })}
                  title="Summarise the conversation in place"
                >
                  <Minimize2 />
                  Compact
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={!running || inject.isPending}
                  onClick={() => inject.mutate({ action: "clear", handoff: true })}
                  title="New session with a handoff note"
                >
                  <ScrollText />
                  Clear + handoff
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={!running || inject.isPending}
                  onClick={() => inject.mutate({ action: "clear", handoff: false })}
                  title="New session with an empty context"
                >
                  <Eraser />
                  Clear
                </Button>
                {running ? (
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={close.isPending}
                    onClick={() => close.mutate()}
                  >
                    {close.isPending ? <Loader2 className="animate-spin" /> : <Power />}
                    Close
                  </Button>
                ) : null}
              </div>
            </div>
            <TerminalView
              key={terminal.id}
              terminalId={terminal.id}
              interactive={running}
              onState={store}
              className="h-[60vh] min-h-80"
            />
          </>
        ) : (
          <div className="grid min-h-80 flex-1 place-items-center rounded-lg border border-dashed border-border bg-surface-0/40 text-sm text-muted-foreground">
            No terminal yet.
          </div>
        )}
        {!running ? (
          <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-surface-0/60 p-3">
            <div className="min-w-56 flex-1 space-y-1.5">
              <label htmlFor="terminal-model" className="text-xs text-muted-foreground">
                Model
              </label>
              <ModelSelect
                id="terminal-model"
                models={catalog.models}
                value={model}
                onChange={setModel}
                defaultLabel="Session model, else agent default"
              />
            </div>
            <label className="flex h-9 items-center gap-2 text-sm text-muted-foreground">
              <input
                type="checkbox"
                className="size-4 accent-[var(--primary)]"
                checked={fresh}
                onChange={(event) => setFresh(event.target.checked)}
              />
              Fresh context
            </label>
            <Button onClick={() => open.mutate()} disabled={open.isPending}>
              {open.isPending ? <Loader2 className="animate-spin" /> : <Play />}
              {terminal ? "Open again" : "Open terminal"}
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
