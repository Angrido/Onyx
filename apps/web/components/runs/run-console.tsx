"use client";

import type { RunDto, RunEventsResponse, ServerMessage } from "@onyx/contracts";
import { channels } from "@onyx/contracts/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FlaskConical, Loader2, Repeat2, ShieldX, Square } from "lucide-react";
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
import { formatDuration, formatSaving, formatTokens, formatUsd } from "@/lib/format";
import {
  INITIAL_FEED,
  applyDelta,
  applyRunEvent,
  activeTool,
  feedContextTokens,
  feedUsage,
  isTerminal,
  type FeedState,
} from "@/lib/run-feed";
import { runSaving } from "@/lib/savings";
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

function Metric({
  label,
  value,
  className,
  title,
}: {
  label: string;
  value: string;
  className?: string | undefined;
  title?: string;
}) {
  return (
    <div className={cn("min-w-0", className)} title={title}>
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
      void queryClient.invalidateQueries({ queryKey: queryKeys.run(run.id) });
    }
    wasTerminal.current = terminal;
  }, [terminal, queryClient, run.taskId, run.id]);

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
  const { data: latest = run } = useQuery({
    queryKey: queryKeys.run(run.id),
    queryFn: () => api.get<RunDto>(`/api/runs/${run.id}`),
    initialData: run,
    staleTime: Infinity,
  });
  const saving = runSaving(feed.context, terminal ? latest.context : null);
  const savingRatio = saving.kind === "estimate" ? (saving.net ?? saving.gross) : null;
  const model = feed.model ?? run.modelId;

  return (
    <Card className={cn("flex min-h-0 flex-col overflow-hidden", className)}>
      <div className="space-y-4 border-b border-border px-5 py-4">
        <div className="flex items-center gap-4">
          <AgentOrb
            tier={tierOfModel(model)}
            status={status}
            tool={activeTool({ entries: feed.entries, status })}
            size={44}
          />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <ModelBadge modelId={model} />
              <RunStatusBadge status={status} />
              {Math.max(feed.guardDenials, run.guardDenials) > 0 ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-warning/15 px-2 py-0.5 text-[11px] font-medium text-warning">
                  <ShieldX className="size-3" />
                  {Math.max(feed.guardDenials, run.guardDenials)} blocked
                </span>
              ) : null}
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
        <div className="grid grid-cols-3 gap-x-6 gap-y-3 rounded-lg border border-border bg-surface-0/50 px-4 py-3 sm:grid-cols-7">
          <Metric label="Input" value={formatTokens(usage.inputTokens)} />
          <Metric label="Output" value={formatTokens(usage.outputTokens)} />
          <Metric label="Cache read" value={formatTokens(usage.cacheReadTokens)} />
          <Metric label="Window" value={formatTokens(feedContextTokens(feed))} />
          <Metric
            label={saving.kind === "estimate" && saving.net !== null ? "Net context" : "Context"}
            title="Context tokens with Onyx compared with reading the target files and their dependencies in full: negative is fewer tokens. Net subtracts the files read again. Estimate."
            value={
              saving.kind === "control"
                ? "control"
                : savingRatio === null
                  ? "—"
                  : formatSaving(savingRatio)
            }
            className={
              savingRatio === null ? undefined : savingRatio >= 0 ? "text-success" : "text-warning"
            }
          />
          <Metric label="Cost" value={formatUsd(costUsd)} />
          <Metric label="Elapsed" value={formatDuration(elapsed)} />
        </div>
        {saving.kind === "control" ? (
          <p
            className="flex items-center gap-2 text-xs text-muted-foreground"
            data-testid="run-saving-note"
          >
            <FlaskConical className="size-3.5 shrink-0 text-primary" />
            Control run of the savings experiment: no context pack, project map or MCP tools.
          </p>
        ) : saving.kind === "estimate" && saving.net !== null && saving.rereadFiles > 0 ? (
          <p
            className="flex items-center gap-2 text-xs text-muted-foreground"
            data-testid="run-saving-note"
          >
            <Repeat2 className="size-3.5 shrink-0 text-warning" />
            Read again {saving.rereadFiles} {saving.rereadFiles === 1 ? "file" : "files"} the pack
            already covered (~{formatTokens(saving.rereadTokens)} tokens). Context vs full reads:{" "}
            {formatSaving(saving.net)} after re-reads, {formatSaving(saving.gross)} before
            (estimate).
          </p>
        ) : null}
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
