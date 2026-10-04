"use client";

import type { IndexProgress, IndexStatusDto, ServerMessage } from "@onyx/contracts";
import { channels } from "@onyx/contracts/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Network, RefreshCw, ScanSearch, Scissors } from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { useCallback } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { RelativeTime } from "@/components/ui/relative-time";
import { api, errorMessage } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/keys";
import { formatDuration, formatPercent, formatTokens } from "@/lib/format";
import { useT } from "@/lib/i18n/client";
import { msg } from "@/lib/i18n/core";
import { useChannel } from "@/lib/ws/context";

const PHASE_LABELS: Record<IndexProgress["phase"], string> = {
  enumerating: msg("Scanning files"),
  analyzing: msg("Parsing with tree-sitter"),
  linking: msg("Resolving imports"),
  ranking: msg("Ranking the graph"),
  saving: msg("Saving the index"),
};

function ProgressBar({ progress }: { progress: IndexProgress | null }) {
  const t = useT();
  const ratio = progress && progress.total > 0 ? progress.done / progress.total : null;
  return (
    <div className="space-y-1.5">
      <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
        {ratio === null ? (
          <motion.div
            className="h-full w-1/3 rounded-full bg-primary/70"
            animate={{ x: ["-100%", "300%"] }}
            transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
          />
        ) : (
          <motion.div
            className="h-full rounded-full bg-primary"
            animate={{ width: `${Math.round(ratio * 100)}%` }}
            transition={{ type: "spring", stiffness: 120, damping: 20 }}
          />
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        {progress ? t(PHASE_LABELS[progress.phase]) : t("Starting")}
        {progress && progress.total > 0
          ? ` · ${t("{done}/{total} files", { done: progress.done, total: progress.total })}`
          : ""}
      </p>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string | undefined }) {
  return (
    <div className="rounded-lg bg-surface-0/60 px-3 py-2" title={hint}>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="font-mono text-sm">{value}</p>
    </div>
  );
}

export function IndexCard({ projectId, initial }: { projectId: string; initial: IndexStatusDto }) {
  const t = useT();
  const queryClient = useQueryClient();
  const key = queryKeys.index(projectId);
  const { data: status } = useQuery({
    queryKey: key,
    queryFn: () => api.get<IndexStatusDto>(`/api/projects/${projectId}/index`),
    initialData: initial,
  });

  const onMessage = useCallback(
    (message: ServerMessage) => {
      if (message.type !== "index.progress") return;
      const event = message.data;
      queryClient.setQueryData<IndexStatusDto>(key, (current) =>
        current
          ? {
              ...current,
              state: event.state,
              progress: event.progress,
              stats: event.stats ?? current.stats,
              error: event.error,
            }
          : current,
      );
      if (event.state !== "indexing") {
        void queryClient.invalidateQueries({ queryKey: key });
        void queryClient.invalidateQueries({ queryKey: queryKeys.allGraphs(projectId) });
      }
    },
    [queryClient, key, projectId],
  );
  useChannel(channels.project(projectId), onMessage);

  const reindex = useMutation({
    mutationFn: () => api.post<IndexStatusDto>(`/api/projects/${projectId}/index`),
    onSuccess: (next) => queryClient.setQueryData(key, next),
    onError: (error) => toast.error(errorMessage(error)),
  });

  const stats = status.stats;
  const compression = stats && stats.rawTokens > 0 ? 1 - stats.l1Tokens / stats.rawTokens : null;

  return (
    <Card className="space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ScanSearch className="size-4 text-primary" />
          <span className="text-sm font-medium">{t("Code index")}</span>
          <span className="text-xs text-muted-foreground">
            {status.state === "indexing" ? (
              t("indexing…")
            ) : status.indexedAt ? (
              <>
                {t("updated")} <RelativeTime iso={status.indexedAt} />
              </>
            ) : (
              t("never indexed")
            )}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            disabled={status.state === "indexing" || reindex.isPending}
            onClick={() => reindex.mutate()}
          >
            <RefreshCw className={status.state === "indexing" ? "animate-spin" : undefined} />
            {t("Re-index")}
          </Button>
          <Button asChild variant="secondary" size="sm" disabled={!status.indexedAt}>
            <Link href={`/projects/${projectId}/graph`}>
              <Network />
              {t("Graph")}
            </Link>
          </Button>
          <Button asChild variant="secondary" size="sm">
            <Link href={`/projects/${projectId}/surgeon`}>
              <Scissors />
              {t("Context Surgeon")}
            </Link>
          </Button>
        </div>
      </div>

      {status.state === "indexing" ? <ProgressBar progress={status.progress} /> : null}
      {status.state === "failed" && status.error ? (
        <p className="flex items-center gap-2 text-xs text-destructive">
          <AlertTriangle className="size-3.5" />
          {status.error}
        </p>
      ) : null}

      {stats ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <Stat
            label={t("Files")}
            value={formatTokens(stats.files)}
            hint={t("{parsed} parsed, {reused} reused from cache", {
              parsed: stats.parsedFiles,
              reused: stats.reusedFiles,
            })}
          />
          <Stat label={t("Symbols")} value={formatTokens(stats.symbols)} />
          <Stat
            label={t("Imports")}
            value={formatTokens(stats.internalEdges)}
            hint={t("{count} external packages", { count: stats.externalModules })}
          />
          <Stat
            label={t("Skeleton saving")}
            value={compression === null ? "—" : formatPercent(compression)}
            hint={t("{raw} tokens of source → {l1} as L1 signatures", {
              raw: formatTokens(stats.rawTokens),
              l1: formatTokens(stats.l1Tokens),
            })}
          />
          <Stat label={t("Cycles")} value={String(stats.cycles)} />
          <Stat
            label={t("Indexed in")}
            value={formatDuration(stats.durationMs)}
            hint={
              stats.sensitiveFiles > 0
                ? t("{count} files withheld by the secret scan", { count: stats.sensitiveFiles })
                : undefined
            }
          />
        </div>
      ) : status.state !== "indexing" ? (
        <p className="text-xs text-muted-foreground">
          {t(
            "Index the project to give agents a project map, skeletons of nearby files and the onyx MCP tools.",
          )}
        </p>
      ) : null}
    </Card>
  );
}
