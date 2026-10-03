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

const TOLERANCE = 0.15;

const REFERENCE_LABELS: Record<TokenCalibration["reference"], string> = {
  anthropic: "Anthropic count_tokens",
  o200k_base: "o200k_base tokenizer",
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
        `Estimator calibrated on ${next.sampleFiles} files; the index is refreshing with the new ratios`,
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
          Estimate vs measured
        </h2>
        <Button
          size="sm"
          variant="secondary"
          disabled={!indexed || measure.isPending}
          onClick={() => measure.mutate()}
        >
          {measure.isPending ? <Loader2 className="animate-spin" /> : <ScanLine />}
          Measure
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Counts the excluded files of the saved profile with a reference tokenizer and compares them
        with the estimate shown here.
        {dirty ? " Save the draft to measure it." : ""}
      </p>
      {result ? (
        <div className="space-y-2" data-testid="surgeon-measure">
          <div className="grid grid-cols-3 gap-2">
            <Figure label="Estimated" value={formatTokens(result.estimatedTokens)} />
            <Figure label="Measured" value={formatTokens(result.measuredTokens)} />
            <Figure
              label="Error"
              value={`${result.error >= 0 ? "+" : "−"}${formatPercent(Math.abs(result.error))}`}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
            <Badge tone={within ? "success" : "warning"}>
              {within ? "within ±15%" : "outside ±15%"}
            </Badge>
            <span>
              {result.sampledFiles} of {result.excludedFiles} files ·{" "}
              {REFERENCE_LABELS[result.reference]}
            </span>
          </div>
        </div>
      ) : null}
      <div className="flex items-center justify-between gap-2 border-t border-border pt-3">
        <p className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
          <CircleGauge className="size-3.5 shrink-0" />
          {calibration ? (
            <span>
              Calibrated on {calibration.sampleFiles} files with{" "}
              {REFERENCE_LABELS[calibration.reference]}{" "}
              <RelativeTime iso={calibration.measuredAt} />
            </span>
          ) : (
            <span>Using built-in chars-per-token ratios</span>
          )}
        </p>
        <Button
          size="sm"
          variant="ghost"
          disabled={!indexed || calibrate.isPending}
          onClick={() => calibrate.mutate()}
        >
          {calibrate.isPending ? <Loader2 className="animate-spin" /> : null}
          Calibrate
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
      toast.success(`Wrote ${response.rules} rules to ${response.path}`);
      void queryClient.invalidateQueries({ queryKey: queryKeys.allSurgeon(projectId) });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
          <FileCode2 className="size-4 text-primary" />
          Compiled for Claude Code
        </h2>
        <Button
          size="sm"
          variant="ghost"
          disabled={exportFile.isPending}
          onClick={() => exportFile.mutate()}
          title={claudesignorePath}
        >
          {exportFile.isPending ? <Loader2 className="animate-spin" /> : <FileDown />}
          Export
        </Button>
      </div>
      {isPending || !data ? (
        <Skeleton className="h-16" />
      ) : (
        <div className="space-y-2" data-testid="surgeon-compiled">
          <div className="grid grid-cols-3 gap-2">
            <Figure label="Mode" value={data.mode} />
            <Figure label="Read deny" value={String(data.readDeny.length)} />
            <Figure label="Edit deny" value={String(data.editDeny.length)} />
          </div>
          <p className="text-[11px] text-muted-foreground">
            Policy <span className="font-mono">{data.hash}</span> · {data.excludedFiles} files ·{" "}
            {formatTokens(data.excludedTokens)} tokens denied
            {data.truncated ? " · rule list truncated, the PreToolUse guard covers the rest" : ""}.
            Every run also gets the guard hook for Read, Grep, Glob and Bash.
          </p>
          <button
            type="button"
            className="text-[11px] font-medium text-muted-foreground hover:text-foreground"
            onClick={() => setOpen((current) => !current)}
          >
            {open ? "Hide" : "Show"} permission rules
          </button>
          {open ? (
            <pre className="scrollbar-thin max-h-56 overflow-auto rounded-md bg-surface-0/70 p-2 font-mono text-[10px] leading-relaxed text-muted-foreground">
              {[...data.readDeny, ...data.editDeny].join("\n")}
            </pre>
          ) : null}
          <p className="text-[11px] text-muted-foreground">
            <span className="font-mono">.claudesignore</span>{" "}
            {claudesignoreExists ? "is present in the project root" : "has not been exported yet"}.
          </p>
        </div>
      )}
    </Card>
  );
}
