"use client";

import type {
  CatalogResponse,
  RunDto,
  RunTaskResponse,
  TaskDetailDto,
  TaskDto,
  TddLoopListResponse,
} from "@onyx/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { GitBranch, History, Loader2, Play, RotateCcw, Route, Square } from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/page-header";
import { RunConsole } from "@/components/runs/run-console";
import { TddLoopPanel } from "@/components/tdd/tdd-loop-panel";
import { TddStartCard } from "@/components/tdd/tdd-start-card";
import { ModelSelect } from "@/components/tasks/model-select";
import {
  ModelBadge,
  RunStatusBadge,
  TaskStatusBadge,
  TierBadge,
} from "@/components/tasks/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Select, Textarea } from "@/components/ui/form-controls";
import { api, errorMessage } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/keys";
import { RelativeTime } from "@/components/ui/relative-time";
import { formatDuration, formatUsd, shortId } from "@/lib/format";
import { ROUTING_STRATEGY_LABELS } from "@/lib/sessions";
import { useLiveTask } from "@/lib/live";
import { isLoopActive } from "@/lib/tdd";
import { cn } from "@/lib/utils";

const ACTIVE_STATUSES = new Set(["QUEUED", "RUNNING", "TDD_LOOP", "PLANNING"]);

function RunControls({ task, catalog }: { task: TaskDetailDto; catalog: CatalogResponse }) {
  const queryClient = useQueryClient();
  const [model, setModel] = useState(task.modelOverride ?? "");
  const [agentConfigId, setAgentConfigId] = useState("");
  const [followUp, setFollowUp] = useState("");
  const [newSession, setNewSession] = useState(false);
  const active = ACTIVE_STATUSES.has(task.status);
  const hasRuns = task.runs.length > 0;

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.task(task.id) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.allTasks });
  };

  const run = useMutation({
    mutationFn: () =>
      api.post<RunTaskResponse>(`/api/tasks/${task.id}/run`, {
        ...(model ? { modelId: model } : {}),
        ...(agentConfigId ? { agentConfigId } : {}),
        ...(followUp.trim() ? { prompt: followUp.trim() } : {}),
        newSession,
      }),
    onSuccess: (response) => {
      setFollowUp("");
      if (response.queuePosition > 0) toast.info(`Queued at position ${response.queuePosition}`);
      invalidate();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const cancel = useMutation({
    mutationFn: () => api.post<TaskDto>(`/api/tasks/${task.id}/cancel`),
    onSuccess: invalidate,
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Dispatch</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Field label="Model" htmlFor="run-model">
          <ModelSelect
            id="run-model"
            models={catalog.models}
            value={model}
            onChange={setModel}
            defaultLabel="Auto (router)"
          />
        </Field>
        <Field label="Agent profile" htmlFor="run-agent">
          <Select
            id="run-agent"
            value={agentConfigId}
            onChange={(event) => setAgentConfigId(event.target.value)}
          >
            <option value="">Workspace default</option>
            {catalog.agentConfigs.map((config) => (
              <option key={config.id} value={config.id}>
                {config.name} · {config.permissionMode}
              </option>
            ))}
          </Select>
        </Field>
        {hasRuns ? (
          <Field
            label="Follow-up prompt"
            htmlFor="run-followup"
            hint="Empty re-sends the original task prompt."
          >
            <Textarea
              id="run-followup"
              className="min-h-20 font-mono text-xs"
              value={followUp}
              onChange={(event) => setFollowUp(event.target.value)}
            />
          </Field>
        ) : null}
        <label className="flex items-center gap-3 text-sm text-muted-foreground">
          <input
            type="checkbox"
            className="size-4 accent-[var(--primary)]"
            checked={newSession}
            onChange={(event) => setNewSession(event.target.checked)}
          />
          Start with a clean context
        </label>
        <div className="flex gap-2">
          <Button
            className="flex-1"
            disabled={active || run.isPending}
            onClick={() => run.mutate()}
          >
            {run.isPending ? (
              <Loader2 className="animate-spin" />
            ) : hasRuns ? (
              <RotateCcw />
            ) : (
              <Play />
            )}
            {hasRuns ? "Run again" : "Run"}
          </Button>
          {active ? (
            <Button
              variant="destructive"
              disabled={cancel.isPending}
              onClick={() => cancel.mutate()}
            >
              {cancel.isPending ? <Loader2 className="animate-spin" /> : <Square />}
              Cancel
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

function RoutingCard({ task, run }: { task: TaskDetailDto; run: RunDto | null }) {
  const workspaceHref = task.workspaceId
    ? `/projects/${task.projectId}/workspaces/${task.workspaceId}`
    : null;
  return (
    <Card data-testid="task-routing">
      <CardHeader className="flex-row items-center gap-2">
        <Route className="size-4 text-muted-foreground" />
        <CardTitle>Routing</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-xs">
        {run?.routing ? (
          <>
            <div className="flex flex-wrap items-center gap-1.5">
              <TierBadge tier={run.routing.tier} />
              <ModelBadge modelId={run.modelId} />
              <Badge>{ROUTING_STRATEGY_LABELS[run.routing.strategy]}</Badge>
            </div>
            <p className="leading-relaxed text-muted-foreground">{run.routing.rationale}</p>
          </>
        ) : (
          <p className="text-muted-foreground">
            {task.modelOverride
              ? `Pinned to ${task.modelOverride}.`
              : "The router decides when the task is dispatched."}
          </p>
        )}
        {workspaceHref ? (
          <Link
            href={workspaceHref}
            className="flex items-center gap-2 rounded-md bg-surface-2 px-2.5 py-1.5 hover:text-foreground"
          >
            <GitBranch className="size-3.5 text-info" />
            <span className="text-muted-foreground">Workspace sessions</span>
            {run ? (
              <span className="ml-auto font-mono" title={run.sessionId}>
                {shortId(run.sessionId)}
              </span>
            ) : null}
          </Link>
        ) : null}
        {run && run.changedFiles.length > 0 ? (
          <div className="space-y-1">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Changed files
            </p>
            <ul className="space-y-0.5 font-mono text-[11px]">
              {run.changedFiles.slice(0, 12).map((file) => (
                <li key={file} className="truncate" title={file}>
                  {file}
                </li>
              ))}
              {run.changedFiles.length > 12 ? (
                <li className="text-muted-foreground">+{run.changedFiles.length - 12} more</li>
              ) : null}
            </ul>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function RunHistory({
  runs,
  selected,
  onSelect,
}: {
  runs: RunDto[];
  selected: string | null;
  onSelect: (runId: string) => void;
}) {
  return (
    <Card>
      <CardHeader className="flex-row items-center gap-2">
        <History className="size-4 text-muted-foreground" />
        <CardTitle>Runs</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1.5">
        {runs.length === 0 ? <p className="text-xs text-muted-foreground">No runs yet.</p> : null}
        {runs.map((run) => (
          <button
            key={run.id}
            type="button"
            onClick={() => onSelect(run.id)}
            className={cn(
              "relative flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-xs transition-colors",
              selected === run.id
                ? "text-foreground"
                : "text-muted-foreground hover:bg-surface-2/60",
            )}
          >
            {selected === run.id ? (
              <motion.span
                layoutId="run-selected"
                className="absolute inset-0 rounded-lg border border-border-strong bg-surface-2"
                transition={{ type: "spring", stiffness: 420, damping: 34 }}
              />
            ) : null}
            <span className="relative flex min-w-0 flex-1 flex-col gap-1">
              <span className="flex flex-wrap items-center gap-2">
                <RunStatusBadge status={run.status} />
                <ModelBadge modelId={run.modelId} />
                {run.routing?.strategy === "ESCALATION" ? (
                  <Badge tone="warning">escalated</Badge>
                ) : null}
              </span>
              <span className="truncate">{run.prompt}</span>
            </span>
            <span className="relative flex flex-col items-end gap-1 tabular">
              <span>{formatUsd(run.costUsd)}</span>
              <span>{formatDuration(run.durationMs)}</span>
            </span>
          </button>
        ))}
      </CardContent>
    </Card>
  );
}

export function TaskDetail({
  initial,
  catalog,
}: {
  initial: TaskDetailDto;
  catalog: CatalogResponse;
}) {
  useLiveTask(initial.id);
  const { data: task } = useQuery({
    queryKey: queryKeys.task(initial.id),
    queryFn: () => api.get<TaskDetailDto>(`/api/tasks/${initial.id}`),
    initialData: initial,
  });
  const { data: loops = [] } = useQuery({
    queryKey: queryKeys.tddLoops(initial.id),
    queryFn: () =>
      api.get<TddLoopListResponse>(`/api/tasks/${initial.id}/tdd`).then((page) => page.items),
  });
  const loopRunning = loops.some(isLoopActive);
  const [pinnedRun, setPinnedRun] = useState<string | null>(null);
  const latestRun = task.runs[0] ?? null;
  const selectedRun = task.runs.find((run) => run.id === pinnedRun) ?? latestRun;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={
          <Link href={`/projects/${task.projectId}`} className="hover:text-foreground">
            ← Project
          </Link>
        }
        title={task.title}
        description={
          <>
            {task.kind.replaceAll("_", " ").toLowerCase()} · updated{" "}
            <RelativeTime iso={task.updatedAt} />
          </>
        }
        actions={<TaskStatusBadge status={task.status} />}
      />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Prompt</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-muted-foreground">
                {task.prompt}
              </p>
              {task.targetPaths.length > 0 ? (
                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
                    Targets
                  </span>
                  {task.targetPaths.map((path) => (
                    <Link
                      key={path}
                      href={`/projects/${task.projectId}/graph?focus=${encodeURIComponent(path)}`}
                      className="rounded-md bg-surface-2 px-2 py-0.5 font-mono text-[11px] hover:text-foreground"
                    >
                      {path}
                    </Link>
                  ))}
                </div>
              ) : null}
            </CardContent>
          </Card>
          {loops.length > 0 ? <TddLoopPanel taskId={task.id} loops={loops} /> : null}
          {selectedRun ? (
            <RunConsole key={selectedRun.id} run={selectedRun} className="h-[70vh]" />
          ) : (
            <Card className="grid h-64 place-items-center text-sm text-muted-foreground">
              Dispatch the task to start an agent.
            </Card>
          )}
        </div>
        <div className="space-y-6">
          <RunControls task={task} catalog={catalog} />
          {loopRunning ? null : (
            <TddStartCard task={task} disabled={ACTIVE_STATUSES.has(task.status)} />
          )}
          <RoutingCard task={task} run={selectedRun} />
          <RunHistory
            runs={task.runs}
            selected={selectedRun?.id ?? null}
            onSelect={(runId) => setPinnedRun(runId === latestRun?.id ? null : runId)}
          />
        </div>
      </div>
    </div>
  );
}
