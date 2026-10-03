"use client";

import { channels, type RunDto, type RunEventsResponse, type ServerMessage } from "@onyx/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Square } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { toast } from "sonner";
import { AgentOrb } from "@/components/motion/agent-orb";
import { FeedEntryView } from "@/components/runs/feed-entry";
import { ModelBadge, RunStatusBadge } from "@/components/tasks/status-badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { api, errorMessage } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/keys";
import { formatDuration, formatTokens, formatUsd } from "@/lib/format";
import {
  INITIAL_FEED,
  applyDelta,
  applyRunEvent,
  feedContextTokens,
  feedUsage,
  isTerminal,
  type FeedState,
} from "@/lib/run-feed";
import { tierOfModel } from "@/lib/tiers";
import { cn } from "@/lib/utils";
import { useChannel } from "@/lib/ws/context";

type FeedAction =
  | { type: "event"; seq: number; items: Parameters<typeof applyRunEvent>[2] }
  | { type: "delta"; text: string };

function reducer(state: FeedState, action: FeedAction): FeedState {
  switch (action.type) {
    case "event":
      return applyRunEvent(state, action.seq, action.items);
    case "delta":
      return applyDelta(state, action.text);
  }
}

function useElapsed(startedAt: string, endedAt: string | null, running: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [running]);
  const end = endedAt ? new Date(endedAt).getTime() : now;
  return Math.max(0, end - new Date(startedAt).getTime());
}

function Metric({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className={cn("min-w-0", className)}>
      <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className="tabular truncate text-sm font-semibold">{value}</p>
    </div>
  );
}

export function RunConsole({ run, className }: { run: RunDto; className?: string }) {
  const queryClient = useQueryClient();
  const [feed, dispatch] = useReducer(reducer, INITIAL_FEED);
  const [bootstrapSeq, setBootstrapSeq] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  useEffect(() => {
    let cancelled = false;
    async function bootstrap() {
      let after = 0;
      for (;;) {
        const page = await api.get<RunEventsResponse>(
          `/api/runs/${run.id}/events?after=${after}&limit=500`,
        );
        if (cancelled) return;
        for (const event of page.items)
          dispatch({ type: "event", seq: event.seq, items: event.items });
        after = page.items.at(-1)?.seq ?? after;
        if (page.nextAfter === null) break;
      }
      setBootstrapSeq(after);
    }
    bootstrap().catch((error: unknown) => toast.error(errorMessage(error)));
    return () => {
      cancelled = true;
    };
  }, [run.id]);

  const onMessage = useCallback((message: ServerMessage) => {
    if (message.type === "run.event")
      dispatch({ type: "event", seq: message.seq, items: message.data.items });
    else if (message.type === "run.delta") dispatch({ type: "delta", text: message.data.text });
  }, []);
  useChannel(channels.run(run.id), onMessage, {
    ...(bootstrapSeq === null ? {} : { since: bootstrapSeq }),
    enabled: bootstrapSeq !== null,
  });

  const status = feed.status ?? run.status;
  const terminal = isTerminal(status);
  const wasTerminal = useRef(isTerminal(run.status));
  useEffect(() => {
    if (terminal && !wasTerminal.current) {
      void queryClient.invalidateQueries({ queryKey: queryKeys.task(run.taskId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.allTasks });
      void queryClient.invalidateQueries({ queryKey: queryKeys.telemetry });
    }
    wasTerminal.current = terminal;
  }, [terminal, queryClient, run.taskId]);

  useEffect(() => {
    const element = scrollRef.current;
    if (element && stickToBottom.current) element.scrollTop = element.scrollHeight;
  }, [feed.entries.length, feed.partialText]);

  const abort = useMutation({
    mutationFn: () => api.post<RunDto>(`/api/runs/${run.id}/abort`),
    onError: (error) => toast.error(errorMessage(error)),
  });

  const usage = feedUsage(feed);
  const costUsd = feed.result?.costUsd ?? run.costUsd;
  const elapsedLive = useElapsed(run.startedAt, run.endedAt, !terminal);
  const elapsed = feed.result?.durationMs ?? elapsedLive;
  const model = feed.model ?? run.modelId;

  return (
    <Card className={cn("flex min-h-0 flex-col overflow-hidden", className)}>
      <div className="space-y-4 border-b border-border px-5 py-4">
        <div className="flex items-center gap-4">
          <AgentOrb tier={tierOfModel(model)} status={status} size={44} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <ModelBadge modelId={model} />
              <RunStatusBadge status={status} />
            </div>
            <p className="mt-1.5 truncate font-mono text-[11px] text-muted-foreground">
              run {run.id}
            </p>
          </div>
          {!terminal ? (
            <Button
              variant="destructive"
              size="sm"
              disabled={abort.isPending}
              onClick={() => abort.mutate()}
            >
              {abort.isPending ? <Loader2 className="animate-spin" /> : <Square />}
              Abort
            </Button>
          ) : null}
        </div>
        <div className="grid grid-cols-3 gap-x-6 gap-y-3 rounded-lg border border-border bg-surface-0/50 px-4 py-3 sm:grid-cols-6">
          <Metric label="Input" value={formatTokens(usage.inputTokens)} />
          <Metric label="Output" value={formatTokens(usage.outputTokens)} />
          <Metric label="Cache read" value={formatTokens(usage.cacheReadTokens)} />
          <Metric label="Context" value={formatTokens(feedContextTokens(feed))} />
          <Metric label="Cost" value={formatUsd(costUsd)} />
          <Metric label="Elapsed" value={formatDuration(elapsed)} />
        </div>
      </div>
      <div
        ref={scrollRef}
        onScroll={(event) => {
          const element = event.currentTarget;
          stickToBottom.current =
            element.scrollHeight - element.scrollTop - element.clientHeight < 80;
        }}
        className="scrollbar-thin min-h-[22rem] flex-1 space-y-4 overflow-y-auto px-5 py-5"
      >
        {bootstrapSeq === null && feed.entries.length === 0 ? (
          <div className="space-y-3">
            <Skeleton className="h-10 w-2/3" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-8 w-1/2" />
          </div>
        ) : null}
        <AnimatePresence initial={false}>
          {feed.entries.map((entry) => (
            <motion.div
              key={entry.key}
              layout="position"
              initial={{ opacity: 0, y: 8, filter: "blur(4px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              transition={{ duration: 0.28, ease: "easeOut" }}
            >
              <FeedEntryView entry={entry} cwd={feed.cwd} />
            </motion.div>
          ))}
        </AnimatePresence>
        {feed.partialText ? (
          <p className="whitespace-pre-wrap pl-10 text-sm leading-relaxed text-muted-foreground">
            {feed.partialText}
            <motion.span
              className="ml-0.5 inline-block h-4 w-1.5 translate-y-0.5 bg-primary"
              animate={{ opacity: [1, 0, 1] }}
              transition={{ duration: 1, repeat: Infinity }}
            />
          </p>
        ) : null}
        {!terminal && bootstrapSeq !== null && !feed.partialText ? (
          <div className="flex items-center gap-2 pl-10 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" />
            Agent working…
          </div>
        ) : null}
      </div>
    </Card>
  );
}
