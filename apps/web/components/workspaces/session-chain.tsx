"use client";

import type { ResetWorkspaceResponse, SessionDto, SessionStatus } from "@onyx/contracts";
import { useMutation } from "@tanstack/react-query";
import { ChevronRight, GitBranch, Loader2, RotateCcw, ScrollText } from "lucide-react";
import { motion } from "motion/react";
import { useState } from "react";
import { toast } from "sonner";
import { ModelBadge } from "@/components/tasks/status-badge";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { RelativeTime } from "@/components/ui/relative-time";
import { api, errorMessage } from "@/lib/api/client";
import { formatTokens, shortId } from "@/lib/format";
import { END_REASON_LABELS, SESSION_STATUS_LABELS } from "@/lib/sessions";
import { cn } from "@/lib/utils";

const STATUS_TONES: Record<SessionStatus, NonNullable<BadgeProps["tone"]>> = {
  ACTIVE: "success",
  IDLE: "primary",
  ROTATED: "neutral",
  CLOSED: "neutral",
};

function SessionNode({ session, last }: { session: SessionDto; last: boolean }) {
  const [open, setOpen] = useState(false);
  const pending =
    session.claudeSessionId === null && session.runs === 0 && session.status === "IDLE";
  return (
    <li className="relative flex gap-3" data-testid="session-node">
      <div className="flex flex-col items-center">
        <span
          className={cn(
            "mt-1.5 size-2.5 shrink-0 rounded-full",
            session.status === "ACTIVE" || session.status === "IDLE"
              ? "bg-primary shadow-[0_0_10px_var(--primary)]"
              : "bg-surface-3",
          )}
        />
        {!last ? <span className="mt-1 w-px flex-1 bg-border" /> : null}
      </div>
      <div className="min-w-0 flex-1 space-y-1.5 pb-5">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="font-mono text-sm" title={session.id}>
            {shortId(session.id)}
          </span>
          <Badge tone={STATUS_TONES[session.status]}>
            {pending ? "Pending" : SESSION_STATUS_LABELS[session.status]}
          </Badge>
          <ModelBadge modelId={session.modelId} />
          {session.endReason ? (
            <Badge tone={session.endReason === "DOMAIN_SWITCH" ? "warning" : "neutral"}>
              ended · {END_REASON_LABELS[session.endReason]}
            </Badge>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground">
          {session.runs} runs · {session.turns} turns · {formatTokens(session.contextTokens)}{" "}
          context · started <RelativeTime iso={session.startedAt} />
          {session.endedAt ? (
            <>
              {" "}
              · ended <RelativeTime iso={session.endedAt} />
            </>
          ) : null}
        </p>
        {session.handoffNote ? (
          <div className="rounded-lg border border-info/30 bg-info/8">
            <button
              type="button"
              onClick={() => setOpen((value) => !value)}
              aria-expanded={open}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs"
            >
              <motion.span animate={{ rotate: open ? 90 : 0 }}>
                <ChevronRight className="size-3.5 text-info" />
              </motion.span>
              <ScrollText className="size-3.5 text-info" />
              <span className="font-medium text-info">Handoff note</span>
              <span className="text-muted-foreground">
                {formatTokens(session.handoffTokens ?? 0)} tokens
              </span>
            </button>
            {open ? (
              <pre className="scrollbar-thin max-h-80 overflow-auto whitespace-pre-wrap break-words border-t border-info/20 px-3 py-2 font-mono text-[11px] leading-relaxed text-muted-foreground">
                {session.handoffNote}
              </pre>
            ) : null}
          </div>
        ) : null}
      </div>
    </li>
  );
}

export function SessionChain({
  workspaceId,
  sessions,
  busy,
  onChange,
}: {
  workspaceId: string;
  sessions: SessionDto[];
  busy: boolean;
  onChange: () => void;
}) {
  const reset = useMutation({
    mutationFn: (handoff: boolean) =>
      api.post<ResetWorkspaceResponse>(`/api/workspaces/${workspaceId}/reset`, { handoff }),
    onSuccess: (response, handoff) => {
      toast.success(
        handoff && response.session
          ? "Next run starts a new session with a handoff note"
          : "Next run starts with a clean context",
      );
      onChange();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-3">
        <div className="space-y-1.5">
          <CardTitle className="flex items-center gap-2">
            <GitBranch className="size-4 text-primary" />
            Session chain
          </CardTitle>
          <CardDescription>
            Each Claude session of this workspace, newest first, with why it ended.
          </CardDescription>
        </div>
        <div className="flex gap-1.5">
          <Button
            size="sm"
            variant="secondary"
            disabled={busy || reset.isPending}
            onClick={() => reset.mutate(true)}
            title="Rotate now and prepare a handoff note for the next run"
          >
            {reset.isPending ? <Loader2 className="animate-spin" /> : <ScrollText />}
            Reset + handoff
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy || reset.isPending}
            onClick={() => reset.mutate(false)}
          >
            <RotateCcw />
            Reset
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {sessions.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No sessions yet: the first run or terminal starts one.
          </p>
        ) : (
          <ol data-testid="session-chain">
            {sessions.map((session, index) => (
              <SessionNode
                key={session.id}
                session={session}
                last={index === sessions.length - 1}
              />
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
