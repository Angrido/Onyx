"use client";

import type { TaskDto } from "@onyx/contracts";
import Link from "next/link";
import { AgentOrb } from "@/components/motion/agent-orb";
import { ModelBadge, TaskStatusBadge } from "@/components/tasks/status-badge";
import { RelativeTime } from "@/components/ui/relative-time";
import { formatUsd } from "@/lib/format";
import { tierOfModel } from "@/lib/tiers";

function taskModel(task: TaskDto): string | null {
  return task.lastRun?.modelId ?? task.modelOverride;
}

export function TaskRows({ tasks, testId }: { tasks: readonly TaskDto[]; testId?: string }) {
  return (
    <ul
      className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card/60"
      data-testid={testId}
    >
      {tasks.map((task) => {
        const model = taskModel(task);
        const runStatus = task.lastRun?.status ?? null;
        const live = task.status === "RUNNING" || task.status === "QUEUED";
        return (
          <li key={task.id}>
            <Link
              href={`/tasks/${task.id}`}
              className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-2/60 sm:gap-4"
            >
              <AgentOrb
                tier={model ? tierOfModel(model) : "BUILDER"}
                status={live ? (runStatus ?? "SPAWNING") : runStatus}
                size={30}
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
          </li>
        );
      })}
    </ul>
  );
}
