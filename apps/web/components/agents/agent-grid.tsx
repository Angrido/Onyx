"use client";

import type {
  QueueDto,
  RunDto,
  TaskListResponse,
  TerminalDto,
  TerminalListResponse,
  WorkspaceRef,
} from "@onyx/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ClipboardPaste, LayoutGrid, Loader2, Pause, Play, Power, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { RunConsole } from "@/components/runs/run-console";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/form-controls";
import { TerminalView } from "@/components/workspaces/terminal-view";
import { api, errorMessage } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/keys";
import { formatTokens } from "@/lib/format";
import {
  GRID_STORAGE_KEY,
  MAX_PANELS,
  clampCount,
  defaultPanels,
  fitPanels,
  gridColumns,
  parseLayout,
  sourceFromKey,
  sourceKey,
  type PanelSource,
} from "@/lib/grid";
import { useQueue } from "@/lib/live";
import { useVisible } from "@/lib/use-visible";
import { cn } from "@/lib/utils";

const OPEN_TASK_STATUSES = new Set(["DRAFT", "QUEUED", "INTERRUPTED", "FAILED", "COMPLETED"]);

function Paused() {
  return (
    <div className="grid h-full min-h-64 place-items-center rounded-lg border border-dashed border-border text-xs text-muted-foreground">
      <span className="inline-flex items-center gap-1.5">
        <Pause className="size-3.5" />
        Paused while out of view
      </span>
    </div>
  );
}

function TaskContextPicker({ terminal }: { terminal: TerminalDto }) {
  const [taskId, setTaskId] = useState("");
  const tasks = useQuery({
    queryKey: queryKeys.tasks({ projectId: terminal.projectId }),
    queryFn: () =>
      api.get<TaskListResponse>(
        `/api/tasks?projectId=${encodeURIComponent(terminal.projectId)}&limit=50`,
      ),
  });
  const options = (tasks.data?.items ?? []).filter((task) => OPEN_TASK_STATUSES.has(task.status));
  const paste = useMutation({
    mutationFn: () =>
      api.post<TerminalDto>(`/api/terminals/${terminal.id}/task-context`, { taskId }),
    onSuccess: () => toast.success("Task pasted: review it in the terminal and press Enter"),
    onError: (error) => toast.error(errorMessage(error)),
  });
  return (
    <div className="flex min-w-0 flex-1 items-center gap-1.5">
      <Select
        aria-label={`Task to paste into ${terminal.workspaceName}`}
        className="h-8 min-w-0 flex-1 text-xs"
        value={taskId}
        onChange={(event) => setTaskId(event.target.value)}
      >
        <option value="">Paste a task…</option>
        {options.map((task) => (
          <option key={task.id} value={task.id}>
            {task.title}
          </option>
        ))}
      </Select>
      <Button
        size="sm"
        variant="secondary"
        disabled={!taskId || paste.isPending}
        onClick={() => paste.mutate()}
        data-testid="grid-paste-task"
      >
        {paste.isPending ? <Loader2 className="animate-spin" /> : <ClipboardPaste />}
        Paste
      </Button>
    </div>
  );
}

function TerminalPanelBody({ workspace, visible }: { workspace: WorkspaceRef; visible: boolean }) {
  const queryClient = useQueryClient();
  const key = queryKeys.terminals(workspace.id);
  const { data: terminal = null } = useQuery({
    queryKey: key,
    queryFn: () =>
      api.get<TerminalListResponse>(
        `/api/terminals?workspaceId=${encodeURIComponent(workspace.id)}`,
      ),
    select: (data) => data.items[0] ?? null,
  });
  const store = useCallback(
    (next: TerminalDto) => {
      const previous = queryClient.getQueryData<TerminalListResponse>(key);
      queryClient.setQueryData<TerminalListResponse>(key, {
        items: [next, ...(previous?.items ?? []).filter((item) => item.id !== next.id)],
      });
    },
    [queryClient, key],
  );
  const open = useMutation({
    mutationFn: () => api.post<TerminalDto>(`/api/workspaces/${workspace.id}/terminal`, {}),
    onSuccess: store,
    onError: (error) => toast.error(errorMessage(error)),
  });
  const close = useMutation({
    mutationFn: () => api.delete<TerminalDto>(`/api/terminals/${terminal?.id ?? ""}`),
    onSuccess: store,
    onError: (error) => toast.error(errorMessage(error)),
  });
  const running = terminal?.state === "running";

  if (!terminal || !running) {
    return (
      <div className="grid h-full min-h-64 place-items-center rounded-lg border border-dashed border-border p-4 text-center">
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            {terminal
              ? `The terminal exited${terminal.exitCode === null ? "" : ` with code ${terminal.exitCode}`}.`
              : "No terminal open in this workspace."}
          </p>
          <Button size="sm" onClick={() => open.mutate()} disabled={open.isPending}>
            {open.isPending ? <Loader2 className="animate-spin" /> : <Play />}
            {terminal ? "Open again" : "Open terminal"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <TaskContextPicker terminal={terminal} />
        <Badge title="Context of the last turn">
          {formatTokens(terminal.contextTokens)} / {formatTokens(terminal.maxSessionTokens)}
        </Badge>
        <Button
          size="sm"
          variant="ghost"
          aria-label={`Close the ${workspace.name} terminal`}
          disabled={close.isPending}
          onClick={() => close.mutate()}
        >
          <Power />
        </Button>
      </div>
      {visible ? (
        <TerminalView
          key={terminal.id}
          terminalId={terminal.id}
          interactive={running}
          onState={store}
          className="min-h-64 flex-1"
        />
      ) : (
        <Paused />
      )}
    </div>
  );
}

function RunPanelBody({ runId, visible }: { runId: string; visible: boolean }) {
  const { data: run } = useQuery({
    queryKey: queryKeys.run(runId),
    queryFn: () => api.get<RunDto>(`/api/runs/${runId}`),
  });
  if (!run)
    return (
      <div className="grid h-full min-h-64 place-items-center">
        <Loader2 className="size-4 animate-spin text-muted-foreground" />
      </div>
    );
  return visible ? (
    <RunConsole run={run} className="h-full min-h-64 border-0 shadow-none" />
  ) : (
    <Paused />
  );
}

function Panel({
  index,
  source,
  workspaces,
  queue,
  onChange,
}: {
  index: number;
  source: PanelSource | null;
  workspaces: WorkspaceRef[];
  queue: QueueDto;
  onChange: (source: PanelSource | null) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const visible = useVisible(ref);
  const workspace =
    source?.kind === "terminal"
      ? workspaces.find((entry) => entry.id === source.workspaceId)
      : null;
  const runs = queue.active.filter((run) => run.runId !== null);
  const projects = [...new Set(workspaces.map((entry) => entry.projectName))];
  const selected = sourceKey(source);
  const listedRun = source?.kind === "run" && runs.some((run) => run.runId === source.runId);

  return (
    <Card ref={ref} className="flex h-[32rem] min-w-0 flex-col gap-3 p-3" data-testid="grid-panel">
      <div className="flex items-center gap-2">
        <Select
          aria-label={`Panel ${index + 1}`}
          className="h-8 min-w-0 flex-1 text-xs"
          value={selected}
          onChange={(event) => onChange(sourceFromKey(event.target.value))}
          data-testid="grid-source"
        >
          <option value="">Empty panel</option>
          {runs.length > 0 || (source?.kind === "run" && !listedRun) ? (
            <optgroup label="Live runs">
              {source?.kind === "run" && !listedRun ? (
                <option value={selected}>Run {source.runId.slice(0, 8)}</option>
              ) : null}
              {runs.map((run) => (
                <option key={run.runId} value={`run:${run.runId}`}>
                  {run.title}
                  {run.projectName ? ` · ${run.projectName}` : ""}
                </option>
              ))}
            </optgroup>
          ) : null}
          {projects.map((project) => (
            <optgroup key={project} label={`Terminal · ${project}`}>
              {workspaces
                .filter((entry) => entry.projectName === project)
                .map((entry) => (
                  <option key={entry.id} value={`terminal:${entry.id}`}>
                    {entry.name}
                  </option>
                ))}
            </optgroup>
          ))}
        </Select>
        {source ? (
          <Button
            size="icon"
            variant="ghost"
            className="size-8"
            aria-label={`Empty panel ${index + 1}`}
            onClick={() => onChange(null)}
          >
            <X />
          </Button>
        ) : null}
      </div>
      <div className="min-h-0 flex-1">
        {source?.kind === "run" ? (
          <RunPanelBody runId={source.runId} visible={visible} />
        ) : workspace ? (
          <TerminalPanelBody workspace={workspace} visible={visible} />
        ) : (
          <div className="grid h-full place-items-center rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
            Pick a live run or a workspace terminal above.
          </div>
        )}
      </div>
    </Card>
  );
}

export function AgentGrid({
  workspaces,
  terminals,
  initialQueue,
}: {
  workspaces: WorkspaceRef[];
  terminals: TerminalDto[];
  initialQueue: QueueDto;
}) {
  const { data: queue = initialQueue } = useQueue(initialQueue);
  const fallbackCount = clampCount(initialQueue.maxConcurrent);
  const [count, setCount] = useState(fallbackCount);
  const [panels, setPanels] = useState<(PanelSource | null)[]>(() =>
    defaultPanels(fallbackCount, initialQueue.active, terminals),
  );
  const [restored, setRestored] = useState(false);

  useEffect(() => {
    const restore = () => {
      let saved: ReturnType<typeof parseLayout> = null;
      try {
        saved = parseLayout(window.localStorage.getItem(GRID_STORAGE_KEY));
      } catch {
        saved = null;
      }
      if (saved && saved.panels.some(Boolean)) {
        setCount(saved.count);
        setPanels(fitPanels(saved.panels, saved.count));
      }
      setRestored(true);
    };
    const timer = setTimeout(restore, 0);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!restored) return;
    try {
      window.localStorage.setItem(GRID_STORAGE_KEY, JSON.stringify({ count, panels }));
    } catch {
      return;
    }
  }, [count, panels, restored]);

  const sizes = useMemo(() => Array.from({ length: MAX_PANELS }, (_, index) => index + 1), []);
  const running = queue.active.length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground" data-testid="grid-summary">
          {running} of {queue.maxConcurrent} agent {queue.maxConcurrent === 1 ? "slot" : "slots"} in
          use
          {queue.reservedSlots > 0 ? `, ${queue.reservedSlots} by terminals` : ""}. Each open
          terminal takes a slot and draws on the same Claude limits as the runs.{" "}
          <Link href="/telemetry#quota" className="text-primary hover:underline">
            Limits
          </Link>
        </p>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <LayoutGrid className="size-3.5" />
          Panels
          <Select
            className="h-8 w-20"
            value={String(count)}
            onChange={(event) => {
              const next = clampCount(Number(event.target.value));
              setCount(next);
              setPanels((current) => fitPanels(current, next));
            }}
            data-testid="grid-count"
          >
            {sizes.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </Select>
        </label>
      </div>
      <div className={cn("grid gap-4", gridColumns(count))}>
        {fitPanels(panels, count).map((source, index) => (
          <Panel
            key={`${index}-${sourceKey(source)}`}
            index={index}
            source={source}
            workspaces={workspaces}
            queue={queue}
            onChange={(next) =>
              setPanels((current) => {
                const updated = fitPanels(current, count);
                updated[index] = next;
                return updated;
              })
            }
          />
        ))}
      </div>
    </div>
  );
}
