"use client";

import type {
  CatalogResponse,
  RunDto,
  RunTaskResponse,
  TaskDetailDto,
  TaskDto,
} from "@onyx/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { History, Loader2, Play, RotateCcw, Square } from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/page-header";
import { RunConsole } from "@/components/runs/run-console";
import { ModelSelect } from "@/components/tasks/model-select";
import { ModelBadge, RunStatusBadge, TaskStatusBadge } from "@/components/tasks/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Select, Textarea } from "@/components/ui/form-controls";
import { api, errorMessage } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/keys";
import { RelativeTime } from "@/components/ui/relative-time";
import { formatDuration, formatUsd } from "@/lib/format";
import { useLiveTask } from "@/lib/live";
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
            defaultLabel="Agent default"
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
              <span className="flex items-center gap-2">
                <RunStatusBadge status={run.status} />
                <ModelBadge modelId={run.modelId} />
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
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Prompt</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-muted-foreground">
                {task.prompt}
              </p>
            </CardContent>
          </Card>
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
