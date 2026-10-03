"use client";

import type {
  CatalogResponse,
  ProjectBoard,
  RoadmapGenerationDto,
  RoadmapItemDto,
  RunTaskResponse,
  TaskDto,
  WorkspaceDto,
} from "@onyx/contracts";
import { channels } from "@onyx/contracts/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  CheckCircle2,
  FileCode2,
  GitBranch,
  Loader2,
  Play,
  Sparkles,
  Square,
  X,
  XCircle,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useCallback, useMemo, useState, type DragEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { GenerateRoadmapDialog } from "@/components/roadmap/generate-roadmap-dialog";
import { ModelBadge, TaskStatusBadge } from "@/components/tasks/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RelativeTime } from "@/components/ui/relative-time";
import { api, errorMessage } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/keys";
import {
  COLUMNS,
  PRIORITY_STYLES,
  groupTasks,
  moveFor,
  priorityOfWeight,
  type ColumnId,
  type DragItem,
  type Move,
} from "@/lib/board";
import { formatUsd } from "@/lib/format";
import { KIND_LABELS } from "@/lib/router";
import { cn } from "@/lib/utils";
import { useChannel } from "@/lib/ws/context";

const DRAG_TYPE = "application/x-onyx-card";

function GenerationBanner({ generation }: { generation: RoadmapGenerationDto }) {
  if (generation.status === "RUNNING") {
    return (
      <div
        className="flex flex-wrap items-center gap-3 rounded-xl border border-primary/30 bg-primary/8 px-4 py-3 text-sm"
        data-testid="roadmap-running"
      >
        <Loader2 className="size-4 animate-spin text-primary" />
        <span className="font-medium">Claude is studying the project</span>
        {generation.activity ? (
          <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
            {generation.activity.turns} turns · {generation.activity.toolCalls} tool calls ·{" "}
            {generation.activity.lastAction ?? "thinking"}
          </span>
        ) : null}
      </div>
    );
  }
  if (generation.status === "FAILED") {
    return (
      <div className="flex items-start gap-3 rounded-xl border border-destructive/40 bg-destructive/8 px-4 py-3 text-sm">
        <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
        <div>
          <p className="font-medium text-destructive">The roadmap could not be generated</p>
          <p className="text-xs text-muted-foreground">{generation.error}</p>
        </div>
      </div>
    );
  }
  return (
    <div
      className="flex flex-wrap items-start gap-3 rounded-xl border border-border bg-surface-1/70 px-4 py-3 text-sm"
      data-testid="roadmap-summary"
    >
      <Sparkles className="mt-0.5 size-4 shrink-0 text-primary" />
      <div className="min-w-0 flex-1 space-y-1">
        <p>{generation.summary ?? `${generation.itemCount} suggestions`}</p>
        <p className="text-xs text-muted-foreground">
          {generation.itemCount} suggestions · {generation.modelId} ·{" "}
          {generation.costUsd !== null ? `${formatUsd(generation.costUsd)} · ` : ""}
          {generation.endedAt ? <RelativeTime iso={generation.endedAt} /> : null}
        </p>
      </div>
    </div>
  );
}

function Chips({ paths }: { paths: readonly string[] }) {
  if (paths.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {paths.slice(0, 3).map((path) => (
        <span
          key={path}
          className="flex max-w-full items-center gap-1 truncate rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
          title={path}
        >
          <FileCode2 className="size-3 shrink-0" />
          <span className="truncate">{path}</span>
        </span>
      ))}
      {paths.length > 3 ? (
        <span className="text-[10px] text-muted-foreground">+{paths.length - 3}</span>
      ) : null}
    </div>
  );
}

function CardShell({
  drag,
  children,
  busy,
  testId,
}: {
  drag: DragItem;
  children: ReactNode;
  busy: boolean;
  testId: string;
}) {
  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={{ duration: 0.18 }}
      className={cn(
        "cursor-grab list-none space-y-2 rounded-lg border border-border bg-card p-3 text-sm shadow-sm active:cursor-grabbing",
        busy && "pointer-events-none opacity-60",
      )}
      data-testid={testId}
    >
      <div
        draggable
        onDragStart={(event: DragEvent<HTMLDivElement>) => {
          event.dataTransfer.setData(DRAG_TYPE, JSON.stringify(drag));
          event.dataTransfer.effectAllowed = "move";
        }}
        className="space-y-2"
      >
        {children}
      </div>
    </motion.li>
  );
}

function SuggestionCard({
  item,
  busy,
  onMove,
  onDismiss,
}: {
  item: RoadmapItemDto;
  busy: boolean;
  onMove: () => void;
  onDismiss: () => void;
}) {
  const [open, setOpen] = useState(false);
  const priority = PRIORITY_STYLES[item.priority];
  return (
    <CardShell drag={{ kind: "suggestion", id: item.id }} busy={busy} testId="suggestion-card">
      <div className="flex items-start gap-2">
        <p className="min-w-0 flex-1 font-medium leading-snug">{item.title}</p>
        <button
          type="button"
          aria-label={`Dismiss ${item.title}`}
          onClick={onDismiss}
          className="rounded p-0.5 text-muted-foreground hover:bg-surface-3 hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>
      </div>
      <div className="flex flex-wrap gap-1">
        <span
          className={cn(
            "rounded-full border px-2 py-0.5 text-[10px] font-medium",
            priority.className,
          )}
        >
          {priority.label}
        </span>
        <Badge>{KIND_LABELS[item.kind]}</Badge>
        <Badge>effort {item.effort}</Badge>
        {item.workspaceName ? <Badge>{item.workspaceName}</Badge> : null}
      </div>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={cn(
          "w-full text-left text-xs leading-relaxed text-muted-foreground",
          !open && "line-clamp-3",
        )}
      >
        {item.description}
        {open && item.rationale ? (
          <span className="mt-1 block italic">{item.rationale}</span>
        ) : null}
      </button>
      <Chips paths={item.targetPaths} />
      <Button size="sm" variant="secondary" className="w-full" onClick={onMove}>
        <ArrowRight />
        Move to To do
      </Button>
    </CardShell>
  );
}

function TaskCard({
  task,
  column,
  workspaceName,
  priorityWeight,
  busy,
  onMove,
}: {
  task: TaskDto;
  column: Exclude<ColumnId, "suggested">;
  workspaceName: string | null;
  priorityWeight: number;
  busy: boolean;
  onMove: (move: Move) => void;
}) {
  const priority = PRIORITY_STYLES[priorityOfWeight(priorityWeight)];
  const failed = task.status === "FAILED" || task.status === "INTERRUPTED";
  return (
    <CardShell drag={{ kind: "task", id: task.id, from: column }} busy={busy} testId="task-card">
      <div className="flex items-start gap-2">
        <Link
          href={`/tasks/${task.id}`}
          className="min-w-0 flex-1 font-medium leading-snug hover:text-primary"
          draggable={false}
        >
          {task.title}
        </Link>
        {column === "done" ? <CheckCircle2 className="size-4 shrink-0 text-success" /> : null}
      </div>
      <div className="flex flex-wrap gap-1">
        {column !== "done" ? (
          <span
            className={cn(
              "rounded-full border px-2 py-0.5 text-[10px] font-medium",
              priority.className,
            )}
          >
            {priority.label}
          </span>
        ) : null}
        {column !== "todo" || failed ? <TaskStatusBadge status={task.status} /> : null}
        <Badge>{KIND_LABELS[task.kind]}</Badge>
        {workspaceName ? <Badge>{workspaceName}</Badge> : null}
      </div>
      {task.lastRun ? (
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
          <ModelBadge modelId={task.lastRun.modelId} />
          <span>{formatUsd(task.lastRun.costUsd)}</span>
          {task.lastRun.changedFiles.length > 0 ? (
            <span>{task.lastRun.changedFiles.length} files changed</span>
          ) : null}
        </div>
      ) : null}
      {column === "done" && task.branchName ? (
        <p className="flex items-center gap-1.5 truncate font-mono text-[11px] text-muted-foreground">
          <GitBranch className="size-3 shrink-0" />
          {task.branchName}
        </p>
      ) : null}
      {column === "todo" ? (
        <Button size="sm" className="w-full" onClick={() => onMove("run")}>
          <Play />
          {failed ? "Retry" : "Start"}
        </Button>
      ) : null}
      {column === "inProgress" ? (
        <Button size="sm" variant="ghost" className="w-full" onClick={() => onMove("cancel")}>
          <Square />
          Stop and move back
        </Button>
      ) : null}
    </CardShell>
  );
}

function Column({
  id,
  title,
  hint,
  count,
  dragging,
  onDropItem,
  children,
}: {
  id: ColumnId;
  title: string;
  hint: string;
  count: number;
  dragging: DragItem | null;
  onDropItem: (item: DragItem, to: ColumnId) => void;
  children: ReactNode;
}) {
  const [over, setOver] = useState(false);
  const allowed = dragging !== null && moveFor(dragging, id) !== null;
  return (
    <section
      className={cn(
        "flex min-h-64 flex-col rounded-xl border bg-surface-1/50 p-3 transition-colors",
        over && allowed ? "border-primary/60 bg-primary/8" : "border-border",
        dragging !== null && !allowed && "opacity-60",
      )}
      data-testid={`column-${id}`}
      onDragOver={(event) => {
        if (!allowed) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setOver(false);
        const raw = event.dataTransfer.getData(DRAG_TYPE);
        if (!raw) return;
        onDropItem(JSON.parse(raw) as DragItem, id);
      }}
    >
      <header className="mb-3 flex items-baseline justify-between gap-2 px-1">
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
          <p className="text-[11px] text-muted-foreground">{hint}</p>
        </div>
        <span className="tabular rounded-full bg-surface-2 px-2 py-0.5 text-xs text-muted-foreground">
          {count}
        </span>
      </header>
      <ul className="flex flex-1 flex-col gap-2">
        <AnimatePresence initial={false}>{children}</AnimatePresence>
      </ul>
    </section>
  );
}

export function RoadmapBoard({
  projectId,
  initial,
  workspaces,
  catalog,
  gitPanel,
}: {
  projectId: string;
  initial: ProjectBoard;
  workspaces: WorkspaceDto[];
  catalog: CatalogResponse;
  gitPanel?: ReactNode;
}) {
  const queryClient = useQueryClient();
  const [dragging, setDragging] = useState<DragItem | null>(null);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const board = useQuery({
    queryKey: queryKeys.board(projectId),
    queryFn: () => api.get<ProjectBoard>(`/api/projects/${projectId}/board`),
    initialData: initial,
    refetchInterval: (query) => {
      const data = query.state.data;
      if (data?.generation?.status === "RUNNING") return 1_500;
      return data?.tasks.some((task) => ["QUEUED", "RUNNING"].includes(task.status))
        ? 4_000
        : false;
    },
  });
  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.board(projectId) });
  }, [queryClient, projectId]);
  useChannel(channels.project(projectId), refresh);

  const data = board.data;
  const grouped = useMemo(() => groupTasks(data.tasks), [data.tasks]);
  const workspaceNames = useMemo(
    () => new Map(workspaces.map((workspace) => [workspace.id, workspace.name])),
    [workspaces],
  );
  const running = data.generation?.status === "RUNNING";

  const act = useMutation({
    mutationFn: async ({ item, move }: { item: DragItem; move: Move }) => {
      if (move === "accept") return api.post<TaskDto>(`/api/roadmap-items/${item.id}/accept`, {});
      if (move === "run") return api.post<RunTaskResponse>(`/api/tasks/${item.id}/run`, {});
      return api.post<TaskDto>(`/api/tasks/${item.id}/cancel`);
    },
    onMutate: ({ item }) => setPending((current) => new Set(current).add(item.id)),
    onSettled: (_data, _error, { item }) => {
      setPending((current) => {
        const next = new Set(current);
        next.delete(item.id);
        return next;
      });
      refresh();
    },
    onSuccess: (_data, { move }) => {
      if (move === "run") toast.success("Task started");
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const dismiss = useMutation({
    mutationFn: (id: string) => api.post<RoadmapItemDto>(`/api/roadmap-items/${id}/dismiss`),
    onSuccess: refresh,
    onError: (error) => toast.error(errorMessage(error)),
  });

  const perform = (item: DragItem, move: Move) => {
    if (move === "cancel" && !window.confirm("Stop this task and move it back to To do?")) return;
    act.mutate({ item, move });
  };

  const onDropItem = (item: DragItem, to: ColumnId) => {
    setDragging(null);
    const move = moveFor(item, to);
    if (move) perform(item, move);
  };

  return (
    <div
      className="space-y-4"
      onDragStart={(event) => {
        const raw = event.dataTransfer.getData(DRAG_TYPE);
        if (raw) setDragging(JSON.parse(raw) as DragItem);
      }}
      onDragEnd={() => setDragging(null)}
    >
      <div className="flex flex-wrap items-center gap-2">
        <GenerateRoadmapDialog
          projectId={projectId}
          catalog={catalog}
          running={running}
          hasSuggestions={data.suggestions.length > 0}
        />
        <span className="text-xs text-muted-foreground">
          Drag cards between columns, or use the buttons on each card.
        </span>
      </div>
      {data.generation ? <GenerationBanner generation={data.generation} /> : null}
      {gitPanel ? <div>{gitPanel}</div> : null}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {COLUMNS.map((column) => {
          const cards =
            column.id === "suggested"
              ? data.suggestions.map((item) => (
                  <SuggestionCard
                    key={item.id}
                    item={item}
                    busy={pending.has(item.id)}
                    onMove={() => perform({ kind: "suggestion", id: item.id }, "accept")}
                    onDismiss={() => dismiss.mutate(item.id)}
                  />
                ))
              : grouped[column.id].map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    column={column.id as Exclude<ColumnId, "suggested">}
                    workspaceName={
                      task.workspaceId ? (workspaceNames.get(task.workspaceId) ?? null) : null
                    }
                    priorityWeight={task.priority}
                    busy={pending.has(task.id)}
                    onMove={(move) => perform({ kind: "task", id: task.id, from: column.id }, move)}
                  />
                ));
          return (
            <Column
              key={column.id}
              id={column.id}
              title={column.title}
              hint={column.hint}
              count={cards.length}
              dragging={dragging}
              onDropItem={onDropItem}
            >
              {cards}
            </Column>
          );
        })}
      </div>
      {data.suggestions.length === 0 && data.tasks.length === 0 && !running ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <GitBranch className="size-4" />
          Press Roadmap to let Claude study this project and fill the Suggested column.
        </p>
      ) : null}
    </div>
  );
}
