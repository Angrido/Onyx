"use client";

import type { TaskDto, TaskListResponse } from "@onyx/contracts";
import { useQuery } from "@tanstack/react-query";
import { ListTodo } from "lucide-react";
import { useState, type ReactNode } from "react";
import { TaskRows } from "@/components/projects/task-rows";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/skeleton";
import { api } from "@/lib/api/client";
import { useT } from "@/lib/i18n/client";
import { useLiveSystem } from "@/lib/live";
import { RECENT_TASKS_FETCHED, RECENT_TASKS_SHOWN, firstItems } from "@/lib/project-tasks";

export function RecentTasks({
  initial,
  emptyAction,
}: {
  initial: TaskDto[];
  emptyAction?: ReactNode;
}) {
  const t = useT();
  useLiveSystem();
  const [expanded, setExpanded] = useState(false);
  const { data } = useQuery({
    queryKey: ["tasks", "recent"] as const,
    queryFn: async () =>
      (await api.get<TaskListResponse>(`/api/tasks?limit=${RECENT_TASKS_FETCHED}`)).items,
    initialData: initial,
  });
  const { visible, hidden } = firstItems(data, expanded ? data.length : RECENT_TASKS_SHOWN);
  return (
    <section className="space-y-3" aria-labelledby="recent-tasks-heading">
      <h2 id="recent-tasks-heading" className="text-sm font-semibold tracking-tight">
        {t("Recent tasks")}
      </h2>
      {data.length === 0 ? (
        <EmptyState
          icon={<ListTodo className="size-5" />}
          title={t("No tasks yet")}
          description={t("Create a task to hand work to a Claude Code agent.")}
          action={emptyAction}
        />
      ) : (
        <>
          <TaskRows tasks={visible} testId="recent-tasks" />
          {hidden > 0 || expanded ? (
            <Button
              variant="ghost"
              size="sm"
              aria-expanded={expanded}
              onClick={() => setExpanded((value) => !value)}
            >
              {expanded ? t("Show fewer") : t("Show {count} more", { count: hidden })}
            </Button>
          ) : null}
        </>
      )}
    </section>
  );
}
