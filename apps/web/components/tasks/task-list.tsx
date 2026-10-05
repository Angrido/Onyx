"use client";

import type { TaskDto, TaskListResponse } from "@onyx/contracts";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { ListTodo } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { AgentOrb } from "@/components/motion/agent-orb";
import { ModelBadge, TaskStatusBadge } from "@/components/tasks/status-badge";
import { EmptyState } from "@/components/ui/skeleton";
import { api } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/keys";
import { RelativeTime } from "@/components/ui/relative-time";
import { formatUsd } from "@/lib/format";
import { useT } from "@/lib/i18n/client";
import { useLiveProject, useLiveSystem } from "@/lib/live";
import { tierOfModel } from "@/lib/tiers";

function LiveProject({ projectId }: { projectId: string }) {
  useLiveProject(projectId);
  return null;
}

function LiveSystem() {
  useLiveSystem();
  return null;
}

function taskModel(task: TaskDto): string | null {
  return task.lastRun?.modelId ?? task.modelOverride;
}

export function TaskList({
  initial,
  projectId,
  emptyAction,
}: {
  initial: TaskDto[];
  projectId?: string;
  emptyAction?: ReactNode;
}) {
  const t = useT();
  const filter = projectId ? { projectId } : {};
  const { data } = useQuery({
    queryKey: queryKeys.tasks(filter),
    queryFn: async () => {
      const search = projectId ? `?projectId=${encodeURIComponent(projectId)}` : "";
      return (await api.get<TaskListResponse>(`/api/tasks${search}`)).items;
    },
    initialData: initial,
  });

  return (
    <>
      {projectId ? <LiveProject projectId={projectId} /> : <LiveSystem />}
      {data.length === 0 ? (
        <EmptyState
          icon={<ListTodo className="size-5" />}
          title={t("No tasks yet")}
          description={t("Create a task to hand work to a Claude Code agent.")}
          action={emptyAction}
        />
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card/60">
          <AnimatePresence initial={false}>
            {data.map((task) => {
              const model = taskModel(task);
              const runStatus = task.lastRun?.status ?? null;
              const live = task.status === "RUNNING" || task.status === "QUEUED";
              return (
                <motion.li
                  key={task.id}
                  layout
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ type: "spring", stiffness: 420, damping: 36 }}
                >
                  <Link
                    href={`/tasks/${task.id}`}
                    className="flex items-center gap-4 px-4 py-3 transition-colors hover:bg-surface-2/60"
                  >
                    <AgentOrb
                      tier={model ? tierOfModel(model) : "BUILDER"}
                      status={live ? (runStatus ?? "SPAWNING") : runStatus}
                      size={34}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{task.title}</p>
                      <p className="truncate text-xs text-muted-foreground">{task.prompt}</p>
                    </div>
                    <div className="hidden items-center gap-2 md:flex">
                      {model ? <ModelBadge modelId={model} /> : null}
                      <span className="tabular w-16 text-right text-xs text-muted-foreground">
                        {formatUsd(task.lastRun?.costUsd)}
                      </span>
                    </div>
                    <TaskStatusBadge status={task.status} />
                    <RelativeTime
                      iso={task.updatedAt}
                      className="hidden w-28 whitespace-nowrap text-right text-xs text-muted-foreground lg:block"
                    />
                  </Link>
                </motion.li>
              );
            })}
          </AnimatePresence>
        </ul>
      )}
    </>
  );
}
