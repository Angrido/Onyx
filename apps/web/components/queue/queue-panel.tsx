"use client";

import type { MoveQueuedRequest, QueueDto, QueueItemDto } from "@onyx/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, ArrowUpToLine, ListOrdered, Loader2 } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { RelativeTime } from "@/components/ui/relative-time";
import { api, errorMessage } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/keys";
import { useQueue } from "@/lib/live";
import { KIND_LABELS, WAIT_LABELS, slotSummary } from "@/lib/queue";

function QueuedRow({
  item,
  first,
  last,
  onMove,
  moving,
}: {
  item: QueueItemDto;
  first: boolean;
  last: boolean;
  onMove: (to: MoveQueuedRequest["to"]) => void;
  moving: boolean;
}) {
  const kind = KIND_LABELS[item.kind];
  return (
    <li className="flex items-center gap-3 py-2.5" data-testid="queue-item">
      <span className="w-6 shrink-0 text-right font-mono text-xs text-muted-foreground">
        {item.position}
      </span>
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <Link
            href={`/tasks/${item.taskId}`}
            className="truncate text-sm font-medium hover:underline"
          >
            {item.title}
          </Link>
          {kind ? <Badge tone="primary">{kind}</Badge> : null}
          {item.canWait ? <Badge>can wait</Badge> : null}
        </div>
        <p className="truncate text-xs text-muted-foreground">
          {[item.projectName, item.workspaceName].filter(Boolean).join(" · ")}
          {item.waiting ? ` — ${WAIT_LABELS[item.waiting]}` : ""}
          {item.effectivePriority > item.priority ? " · raised by waiting" : ""}
        </p>
      </div>
      <div className="flex shrink-0 items-center">
        <Button
          size="icon"
          variant="ghost"
          aria-label={`Move ${item.title} to the top`}
          disabled={first || moving}
          onClick={() => onMove("top")}
        >
          <ArrowUpToLine />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          aria-label={`Move ${item.title} up`}
          disabled={first || moving}
          onClick={() => onMove("up")}
        >
          <ArrowUp />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          aria-label={`Move ${item.title} down`}
          disabled={last || moving}
          onClick={() => onMove("down")}
        >
          <ArrowDown />
        </Button>
      </div>
    </li>
  );
}

export function QueuePanel({ initial }: { initial: QueueDto }) {
  const queryClient = useQueryClient();
  const { data: queue = initial } = useQueue(initial);
  const move = useMutation({
    mutationFn: ({ taskId, to }: { taskId: string; to: MoveQueuedRequest["to"] }) =>
      api.post<QueueDto>(`/api/queue/${taskId}/move`, { to }),
    onSuccess: (next) => queryClient.setQueryData(queryKeys.queue, next),
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <Card data-testid="queue-panel">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <ListOrdered className="size-4 text-primary" />
          Run queue
          {move.isPending ? <Loader2 className="size-3.5 animate-spin" /> : null}
        </CardTitle>
        <CardDescription data-testid="queue-slots">
          {slotSummary(queue)}
          {queue.settings.projectLimit !== null
            ? ` · up to ${queue.settings.projectLimit} per project`
            : ""}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {queue.active.length > 0 ? (
          <ul className="divide-y divide-border" aria-label="Running now">
            {queue.active.map((run) => (
              <li key={run.taskId} className="flex items-center gap-3 py-2.5">
                <span className="relative flex size-2 shrink-0" aria-hidden>
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-success/60 motion-reduce:animate-none" />
                  <span className="relative inline-flex size-2 rounded-full bg-success" />
                </span>
                <div className="min-w-0 flex-1">
                  <Link
                    href={run.runId ? `/runs/${run.runId}` : `/tasks/${run.taskId}`}
                    className="block truncate text-sm font-medium hover:underline"
                  >
                    {run.title}
                  </Link>
                  <p className="truncate text-xs text-muted-foreground">
                    {run.projectName ?? "No project"} · started <RelativeTime iso={run.startedAt} />
                  </p>
                </div>
              </li>
            ))}
          </ul>
        ) : null}
        {queue.items.length > 0 ? (
          <ol className="divide-y divide-border border-t border-border" aria-label="Queued">
            {queue.items.map((item, index) => (
              <QueuedRow
                key={item.taskId}
                item={item}
                first={index === 0}
                last={index === queue.items.length - 1}
                moving={move.isPending}
                onMove={(to) => move.mutate({ taskId: item.taskId, to })}
              />
            ))}
          </ol>
        ) : (
          <p className="text-sm text-muted-foreground" data-testid="queue-empty">
            {queue.active.length > 0
              ? "Nothing waiting: new runs start right away."
              : "No runs right now. Start a task and it shows up here."}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
