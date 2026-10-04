"use client";

import type { LogEntryDto, LogListResponse } from "@onyx/contracts";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Loader2, RefreshCw, ScrollText, Search } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Label, Select } from "@/components/ui/form-controls";
import { EmptyState } from "@/components/ui/skeleton";
import { api, errorMessage } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/keys";
import { useLocale, useT } from "@/lib/i18n/client";
import {
  DEFAULT_LOG_FILTER,
  LOG_LEVEL_FILTERS,
  LOG_LEVEL_FILTER_LABELS,
  LOG_LEVEL_TONES,
  contextText,
  formatLogTime,
  logsPath,
  type LogFilterState,
  type LogLevelFilter,
} from "@/lib/system";

const REFRESH_MS = 5_000;
const SEARCH_DELAY_MS = 300;

function LogLine({ entry, mounted }: { entry: LogEntryDto; mounted: boolean }) {
  const t = useT();
  const locale = useLocale();
  const details = contextText(entry);
  return (
    <li className="space-y-1 px-3 py-2 sm:px-4" data-testid="log-line" data-level={entry.level}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        <time dateTime={entry.time} className="tabular font-mono text-muted-foreground">
          {mounted ? formatLogTime(entry.time, new Date(), locale) : entry.time.slice(11, 19)}
        </time>
        <Badge tone={LOG_LEVEL_TONES[entry.level]} className="uppercase">
          {entry.level}
        </Badge>
        {entry.runId ? (
          <Link
            href={`/runs/${entry.runId}`}
            className="font-mono text-primary hover:underline"
            aria-label={t("Open run {id}", { id: entry.runId })}
          >
            {entry.runId.slice(-8)}
          </Link>
        ) : null}
      </div>
      <p className="whitespace-pre-wrap break-words font-mono text-xs text-foreground [overflow-wrap:anywhere]">
        {entry.msg || t("(no message)")}
      </p>
      {details ? (
        <details className="text-xs">
          <summary className="w-fit cursor-pointer rounded text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {t("Details")}
          </summary>
          <pre className="mt-1 whitespace-pre-wrap break-words rounded-md border border-border bg-surface-1 p-2 font-mono text-[11px] text-muted-foreground [overflow-wrap:anywhere]">
            {details}
          </pre>
        </details>
      ) : null}
    </li>
  );
}

export function LogViewer({ initial }: { initial: LogListResponse }) {
  const t = useT();
  const [level, setLevel] = useState<LogLevelFilter>(DEFAULT_LOG_FILTER.level);
  const [runId, setRunId] = useState(DEFAULT_LOG_FILTER.runId);
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [live, setLive] = useState(true);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setMounted(true), 0);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setQ(search), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [search]);

  const filter: LogFilterState = { level, runId, q };
  const isDefault = level === "all" && runId === "" && q.trim() === "";
  const { data, error, isFetching, refetch } = useQuery({
    queryKey: queryKeys.logs(filter),
    queryFn: () => api.get<LogListResponse>(logsPath(filter)),
    placeholderData: keepPreviousData,
    refetchInterval: live ? REFRESH_MS : false,
    ...(isDefault ? { initialData: initial } : {}),
  });
  const result = data ?? initial;
  const runIds =
    runId && !result.runIds.includes(runId) ? [runId, ...result.runIds] : result.runIds;

  return (
    <div className="space-y-4">
      <Card className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_2fr_auto] lg:items-end">
        <div className="space-y-1.5">
          <Label htmlFor="log-level">{t("Level")}</Label>
          <Select
            id="log-level"
            className="h-9"
            value={level}
            onChange={(event) => setLevel(event.target.value as LogLevelFilter)}
            data-testid="log-level"
          >
            {LOG_LEVEL_FILTERS.map((entry) => (
              <option key={entry} value={entry}>
                {t(LOG_LEVEL_FILTER_LABELS[entry])}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="log-run">{t("Agent run")}</Label>
          <Select
            id="log-run"
            className="h-9"
            value={runId}
            onChange={(event) => setRunId(event.target.value)}
            data-testid="log-run"
          >
            <option value="">{t("All runs")}</option>
            {runIds.map((entry) => (
              <option key={entry} value={entry}>
                {entry}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5 sm:col-span-2 lg:col-span-1">
          <Label htmlFor="log-search">{t("Search")}</Label>
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              id="log-search"
              type="search"
              className="h-9 pl-8"
              placeholder={t("Message, id or path")}
              value={search}
              maxLength={200}
              onChange={(event) => setSearch(event.target.value)}
              data-testid="log-search"
            />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3 sm:col-span-2 lg:col-span-1">
          <label className="flex min-h-9 items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 accent-[var(--primary)]"
              checked={live}
              onChange={(event) => setLive(event.target.checked)}
              data-testid="log-live"
            />
            {t("Refresh every 5 s")}
          </label>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void refetch()}
            disabled={isFetching}
          >
            {isFetching ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            {t("Refresh")}
          </Button>
        </div>
      </Card>

      <p className="text-xs text-muted-foreground" aria-live="polite" data-testid="log-summary">
        {t("{shown} of {matched} matching lines · {buffered} of {capacity} kept in memory", {
          shown: result.entries.length,
          matched: result.matched,
          buffered: result.buffered,
          capacity: result.capacity,
        })}
      </p>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {errorMessage(error, t)}
        </p>
      ) : null}

      {result.entries.length === 0 ? (
        <EmptyState
          icon={<ScrollText className="size-5" />}
          title={isDefault ? t("No log lines yet") : t("No log lines match")}
          description={
            isDefault
              ? t("Lines appear here as Onyx works. Start a task or open a project to see them.")
              : t("Clear the search, pick another run or a lower level.")
          }
        />
      ) : (
        <Card className="overflow-hidden">
          <div
            role="region"
            aria-label={t("Log lines, newest first")}
            tabIndex={0}
            className="max-h-[70vh] overflow-y-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            data-testid="log-lines"
          >
            <ol className="divide-y divide-border">
              {result.entries.map((entry) => (
                <LogLine key={entry.seq} entry={entry} mounted={mounted} />
              ))}
            </ol>
          </div>
        </Card>
      )}
    </div>
  );
}
