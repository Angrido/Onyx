"use client";

import type {
  CompiledPolicyDto,
  ExportResponse,
  MeasureResponse,
  TokenCalibration,
} from "@onyx/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleGauge, FileCode2, FileDown, Loader2, Ruler, ScanLine } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { RelativeTime } from "@/components/ui/relative-time";
import { Skeleton } from "@/components/ui/skeleton";
import { api, errorMessage } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/keys";
import { formatPercent, formatTokens } from "@/lib/format";
import { msg } from "@/lib/i18n/core";
import { useT } from "@/lib/i18n/client";

const TOLERANCE = 0.15;

const REFERENCE_LABELS: Record<TokenCalibration["reference"], string> = {
  anthropic: msg("Anthropic count_tokens"),
  o200k_base: msg("o200k_base tokenizer"),
};

function scopeQuery(workspaceId: string | null): string {
  return workspaceId === null ? "" : `?workspaceId=${encodeURIComponent(workspaceId)}`;
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-surface-0/70 px-2 py-1.5">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="font-mono text-sm">{value}</p>
    </div>
  );
}

export function MeasurePanel({
  projectId,
  workspaceId,
  calibration,
  dirty,
  indexed,
}: {
  projectId: string;
  workspaceId: string | null;
  calibration: TokenCalibration | null;
  dirty: boolean;
  indexed: boolean;
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const [result, setResult] = useState<MeasureResponse | null>(null);
  const measure = useMutation({
    mutationFn: () =>
      api.post<MeasureResponse>(
        `/api/projects/${projectId}/surgeon/measure${scopeQuery(workspaceId)}`,
      ),
    onSuccess: setResult,
    onError: (error) => toast.error(errorMessage(error)),
  });
  const calibrate = useMutation({
    mutationFn: () => api.post<TokenCalibration>(`/api/projects/${projectId}/surgeon/calibrate`),
    onSuccess: (next) => {
      toast.success(
        t("Estimator calibrated on {count} files; the index is refreshing with the new ratios", {
          count: next.sampleFiles,
        }),
      );
      setResult(null);
      void queryClient.invalidateQueries({ queryKey: queryKeys.allSurgeon(projectId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.index(projectId) });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const within = result ? Math.abs(result.error) <= TOLERANCE : false;

  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
          <Ruler className="size-4 text-primary" />
          {t("Estimate vs measured")}
        </h2>
        <Button
          size="sm"
          variant="secondary"
          disabled={!indexed || measure.isPending}
          onClick={() => measure.mutate()}
        >
          {measure.isPending ? <Loader2 className="animate-spin" /> : <ScanLine />}
          {t("Measure")}
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground">
        {t(
          "Counts the excluded files of the saved profile with a reference tokenizer and compares them with the estimate shown here.",
        )}
        {dirty ? ` ${t("Save the draft to measure it.")}` : ""}
      </p>
      {result ? (
        <div className="space-y-2" data-testid="surgeon-measure">
          <div className="grid grid-cols-3 gap-2">
            <Figure label={t("Estimated")} value={formatTokens(result.estimatedTokens)} />
            <Figure label={t("Measured")} value={formatTokens(result.measuredTokens)} />
            <Figure
              label={t("Error")}
              value={`${result.error >= 0 ? "+" : "−"}${formatPercent(Math.abs(result.error))}`}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
            <Badge tone={within ? "success" : "warning"}>
              {within ? t("within ±15%") : t("outside ±15%")}
            </Badge>
            <span>
              {t("{count} of {total} files", {
                count: result.sampledFiles,
                total: result.excludedFiles,
              })}{" "}
              · {t(REFERENCE_LABELS[result.reference])}
            </span>
          </div>
        </div>
      ) : null}
      <div className="flex items-center justify-between gap-2 border-t border-border pt-3">
        <p className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
          <CircleGauge className="size-3.5 shrink-0" />
          {calibration ? (
            <span>
              {t("Calibrated on {count} files with {reference}", {
                count: calibration.sampleFiles,
                reference: t(REFERENCE_LABELS[calibration.reference]),
              })}{" "}
              <RelativeTime iso={calibration.measuredAt} />
            </span>
          ) : (
            <span>{t("Using built-in chars-per-token ratios")}</span>
          )}
        </p>
        <Button
          size="sm"
          variant="ghost"
          disabled={!indexed || calibrate.isPending}
          onClick={() => calibrate.mutate()}
        >
          {calibrate.isPending ? <Loader2 className="animate-spin" /> : null}
          {t("Calibrate")}
        </Button>
      </div>
    </Card>
  );
}

export function CompiledPanel({
  projectId,
  workspaceId,
  version,
  claudesignorePath,
  claudesignoreExists,
}: {
  projectId: string;
  workspaceId: string | null;
  version: string;
  claudesignorePath: string;
  claudesignoreExists: boolean;
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const { data, isPending } = useQuery({
    queryKey: queryKeys.surgeonCompiled(projectId, workspaceId, version),
    queryFn: () =>
      api.get<CompiledPolicyDto>(
        `/api/projects/${projectId}/surgeon/compiled${scopeQuery(workspaceId)}`,
      ),
  });
  const exportFile = useMutation({
    mutationFn: () => api.post<ExportResponse>(`/api/projects/${projectId}/surgeon/export`),
    onSuccess: (response) => {
      toast.success(
        t("Wrote {count} rules to {path}", { count: response.rules, path: response.path }),
      );
      void queryClient.invalidateQueries({ queryKey: queryKeys.allSurgeon(projectId) });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
          <FileCode2 className="size-4 text-primary" />
          {t("Compiled for Claude Code")}
        </h2>
        <Button
          size="sm"
          variant="ghost"
          disabled={exportFile.isPending}
          onClick={() => exportFile.mutate()}
          title={claudesignorePath}
        >
          {exportFile.isPending ? <Loader2 className="animate-spin" /> : <FileDown />}
          {t("Export")}
        </Button>
      </div>
      {isPending || !data ? (
        <Skeleton className="h-16" />
      ) : (
        <div className="space-y-2" data-testid="surgeon-compiled">
          <div className="grid grid-cols-3 gap-2">
            <Figure label={t("Mode")} value={data.mode} />
            <Figure label={t("Read deny")} value={String(data.readDeny.length)} />
            <Figure label={t("Edit deny")} value={String(data.editDeny.length)} />
          </div>
          <p className="text-[11px] text-muted-foreground">
            {t("Policy")} <span className="font-mono">{data.hash}</span> ·{" "}
            {t("{count} files · {tokens} tokens denied", {
              count: data.excludedFiles,
              tokens: formatTokens(data.excludedTokens),
            })}
            {data.truncated
              ? ` · ${t("rule list truncated, the PreToolUse guard covers the rest")}`
              : ""}
            . {t("Every run also gets the guard hook for Read, Grep, Glob and Bash.")}
          </p>
          <button
            type="button"
            className="text-[11px] font-medium text-muted-foreground hover:text-foreground"
            onClick={() => setOpen((current) => !current)}
          >
            {open ? t("Hide permission rules") : t("Show permission rules")}
          </button>
          {open ? (
            <pre className="scrollbar-thin max-h-56 overflow-auto rounded-md bg-surface-0/70 p-2 font-mono text-[10px] leading-relaxed text-muted-foreground">
              {[...data.readDeny, ...data.editDeny].join("\n")}
            </pre>
          ) : null}
          <p className="text-[11px] text-muted-foreground">
            <span className="font-mono">.claudesignore</span>{" "}
            {claudesignoreExists
              ? t("is present in the project root.")
              : t("has not been exported yet.")}
          </p>
        </div>
      )}
    </Card>
  );
}
