"use client";

import type { IdeationDto, IdeationFindingDto, TaskDto, WorkspaceDto } from "@onyx/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { EyeOff, Lightbulb, ListPlus, Loader2, Play, Sparkles } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Select } from "@/components/ui/form-controls";
import { HelpTip } from "@/components/ui/help-tip";
import { RelativeTime } from "@/components/ui/relative-time";
import { api, errorMessage } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/keys";
import { useT } from "@/lib/i18n/client";
import { formatTokens, formatUsd } from "@/lib/format";
import {
  CATEGORY_LABELS,
  SEVERITY_LABELS,
  SEVERITY_TONES,
  VERDICT_LABELS,
  VERDICT_TONES,
} from "@/lib/insights";
import { cn } from "@/lib/utils";

function FindingRow({
  finding,
  busy,
  onTask,
  onDismiss,
}: {
  finding: IdeationFindingDto;
  busy: boolean;
  onTask: () => void;
  onDismiss: () => void;
}) {
  const t = useT();
  const open = finding.state === "OPEN";
  return (
    <li
      className={cn(
        "space-y-1.5 border-b border-border py-3 last:border-b-0",
        !open && "border-l-2 border-l-border-strong pl-3",
      )}
      data-testid="finding"
      data-rule={finding.rule}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={SEVERITY_TONES[finding.severity]}>
          {t(SEVERITY_LABELS[finding.severity])}
        </Badge>
        <Badge>{t(CATEGORY_LABELS[finding.category])}</Badge>
        <span className="text-sm font-medium">{finding.title}</span>
        {finding.verdict ? (
          <Badge tone={VERDICT_TONES[finding.verdict]}>{t(VERDICT_LABELS[finding.verdict])}</Badge>
        ) : null}
        <span className="text-xs text-muted-foreground">
          {t("confidence {percent}%", { percent: Math.round(finding.confidence * 100) })}
        </span>
      </div>
      {finding.file ? (
        <p className="font-mono text-xs text-muted-foreground">
          {finding.file}
          {finding.line !== null ? `:${finding.line}` : ""}
        </p>
      ) : null}
      {finding.excerpt ? (
        <pre
          className="overflow-x-auto rounded border border-border bg-surface-2 px-2 py-1 font-mono text-xs"
          tabIndex={0}
          role="region"
          aria-label={
            finding.file
              ? t("Flagged code in {file}", { file: finding.file })
              : t("Flagged code in the project")
          }
        >
          {finding.excerpt}
        </pre>
      ) : null}
      <p className="text-sm text-muted-foreground">{finding.explanation}</p>
      {finding.fix ? <p className="text-sm">{t("Fix: {fix}", { fix: finding.fix })}</p> : null}
      <div className="flex flex-wrap items-center gap-2">
        {finding.state === "TASKED" && finding.taskId ? (
          <Link
            href={`/tasks/${finding.taskId}`}
            className="text-sm text-primary underline underline-offset-2"
          >
            {t("Open the task")}
          </Link>
        ) : finding.state === "DISMISSED" ? (
          <span className="text-xs text-muted-foreground">
            {t("Dismissed: hidden from the next analyses")}
          </span>
        ) : (
          <>
            <Button
              size="sm"
              variant="secondary"
              onClick={onTask}
              disabled={busy}
              data-testid="finding-task"
            >
              <ListPlus />
              {t("Create a task")}
            </Button>
            <Button size="sm" variant="ghost" onClick={onDismiss} disabled={busy}>
              <EyeOff />
              {t("Dismiss")}
            </Button>
          </>
        )}
      </div>
    </li>
  );
}

export function IdeationPanel({
  projectId,
  workspaces,
  initial,
}: {
  projectId: string;
  workspaces: WorkspaceDto[];
  initial: IdeationDto;
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const [workspaceId, setWorkspaceId] = useState("");
  const { data } = useQuery({
    queryKey: queryKeys.ideation(projectId),
    queryFn: () => api.get<IdeationDto>(`/api/projects/${projectId}/ideation`),
    initialData: initial,
    refetchInterval: (query) => (query.state.data?.run?.status === "RUNNING" ? 1_500 : false),
  });
  const store = (next: IdeationDto) =>
    queryClient.setQueryData(queryKeys.ideation(projectId), next);
  const start = useMutation({
    mutationFn: () => api.post<IdeationDto>(`/api/projects/${projectId}/ideation`),
    onSuccess: store,
    onError: (error) => toast.error(errorMessage(error)),
  });
  const review = useMutation({
    mutationFn: () => api.post<IdeationDto>(`/api/projects/${projectId}/ideation/review`),
    onSuccess: (next) => {
      store(next);
      void queryClient.invalidateQueries({ queryKey: queryKeys.savings });
      toast.success(t("Claude checked the suspicious points"));
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const dismiss = useMutation({
    mutationFn: (id: string) => api.post<IdeationDto>(`/api/ideation/findings/${id}/dismiss`),
    onSuccess: store,
    onError: (error) => toast.error(errorMessage(error)),
  });
  const task = useMutation({
    mutationFn: (id: string) =>
      api.post<TaskDto>(`/api/ideation/findings/${id}/task`, workspaceId ? { workspaceId } : {}),
    onSuccess: (created) => {
      toast.success(t("Draft task created: {title}", { title: created.title }));
      void queryClient.invalidateQueries({ queryKey: queryKeys.ideation(projectId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.allTasks });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const run = data.run;
  const running = run?.status === "RUNNING" || start.isPending;
  const openFindings = data.findings.filter((finding) => finding.state === "OPEN").length;
  return (
    <Card data-testid="ideation">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Lightbulb className="size-4 text-primary" aria-hidden />
          {t("Ideation: security and performance")}
          <HelpTip term="ideation" />
        </CardTitle>
        <CardDescription>
          {t(
            "Rules on the code, the dependency audit and the import graph run without a model. Claude then reads only the suspicious snippets, if you ask, and each finding can become a task.",
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
          <Button onClick={() => start.mutate()} disabled={running} data-testid="ideation-run">
            {running ? <Loader2 className="animate-spin" /> : <Play />}
            {run ? t("Analyse again") : t("Analyse the project")}
          </Button>
          <Button
            variant="secondary"
            onClick={() => review.mutate()}
            disabled={running || review.isPending || data.reviewable === 0}
            data-testid="ideation-review"
          >
            {review.isPending ? <Loader2 className="animate-spin" /> : <Sparkles />}
            {data.reviewable === 1
              ? t("Ask Claude about 1 suspicious point")
              : t("Ask Claude about {count} suspicious points", { count: data.reviewable })}
          </Button>
          <Field label={t("Workspace for new tasks")} htmlFor="finding-workspace">
            <Select
              id="finding-workspace"
              value={workspaceId}
              onChange={(event) => setWorkspaceId(event.target.value)}
            >
              <option value="">{t("Auto (from the file)")}</option>
              {workspaces.map((workspace) => (
                <option key={workspace.id} value={workspace.id}>
                  {workspace.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        {run ? (
          <p className="text-xs text-muted-foreground" data-testid="ideation-summary">
            {run.status === "RUNNING"
              ? t("Analysing…")
              : run.status === "FAILED"
                ? t("The analysis failed: {message}", { message: run.message ?? t("no details") })
                : `${
                    openFindings === 1
                      ? t("{files} files, 1 open finding", { files: run.files })
                      : t("{files} files, {count} open findings", {
                          files: run.files,
                          count: openFindings,
                        })
                  } · ${run.audit ?? ""}`}
            {run.reviewedAt
              ? ` · ${t("Claude read {tokens} tokens of snippets for {cost}", {
                  tokens: formatTokens(run.snippetTokens ?? 0),
                  cost: formatUsd(run.modelCostUsd ?? 0),
                })}`
              : ""}
            {" · "}
            <RelativeTime iso={run.createdAt} />
          </p>
        ) : null}
        {run?.status === "DONE" && data.findings.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("No suspicious code found by the rules.")}
          </p>
        ) : (
          <ul>
            {data.findings.map((finding) => (
              <FindingRow
                key={finding.id}
                finding={finding}
                busy={task.isPending || dismiss.isPending}
                onTask={() => task.mutate(finding.id)}
                onDismiss={() => dismiss.mutate(finding.id)}
              />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
