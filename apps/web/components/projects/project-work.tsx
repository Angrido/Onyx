"use client";

import type {
  ApprovalListResponse,
  OrchestrationDto,
  OrchestrationListResponse,
  ProjectHealthReport,
  TaskDto,
  TaskListResponse,
} from "@onyx/contracts";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  CircleAlert,
  CircleCheck,
  ClipboardCheck,
  Inbox,
  ListTodo,
  Search,
  Stethoscope,
  TriangleAlert,
} from "lucide-react";
import Link from "next/link";
import { useRef, useState, type ReactNode } from "react";
import { TaskRows } from "@/components/projects/task-rows";
import { TaskStatusBadge } from "@/components/tasks/status-badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/form-controls";
import { EmptyState } from "@/components/ui/skeleton";
import { api } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/keys";
import { useT } from "@/lib/i18n/client";
import { useLiveProject } from "@/lib/live";
import { globalIssues } from "@/lib/mission";
import {
  TASK_FILTERS,
  TASK_FILTER_LABELS,
  TASK_PAGE_SIZE,
  filterTasks,
  firstItems,
  projectStatusFacts,
  taskFilterCounts,
  type TaskFilter,
} from "@/lib/project-tasks";
import { checksSummary } from "@/lib/system";
import { cn } from "@/lib/utils";

const ACTIVE_SHOWN = 3;

function StatusItem({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <li className="flex min-w-0 items-start gap-2 text-sm">
      <span className="mt-0.5 shrink-0 text-muted-foreground [&_svg]:size-4">{icon}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </li>
  );
}

function LinkButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-sm text-left text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {children}
    </button>
  );
}

function useProjectData(
  projectId: string,
  initial: { tasks: TaskDto[]; plans: OrchestrationDto[]; approvals: number },
  health: ProjectHealthReport,
) {
  useLiveProject(projectId);
  const tasks = useQuery({
    queryKey: queryKeys.tasks({ projectId }),
    queryFn: async () =>
      (await api.get<TaskListResponse>(`/api/tasks?projectId=${encodeURIComponent(projectId)}`))
        .items,
    initialData: initial.tasks,
  }).data;
  const plans = useQuery({
    queryKey: queryKeys.orchestrations(projectId),
    queryFn: () =>
      api
        .get<OrchestrationListResponse>(`/api/projects/${projectId}/orchestrations`)
        .then((page) => page.items),
    initialData: initial.plans,
  }).data;
  const approvals = useQuery({
    queryKey: [...queryKeys.approvals, "project", projectId] as const,
    queryFn: async () =>
      (await api.get<ApprovalListResponse>("/api/approvals?status=PENDING&limit=200")).items.filter(
        (item) => item.projectId === projectId,
      ).length,
    initialData: initial.approvals,
  }).data;
  const report = useQuery({
    queryKey: queryKeys.projectHealth(projectId),
    queryFn: () => api.get<ProjectHealthReport>(`/api/projects/${projectId}/health`),
    initialData: health,
  }).data;
  return { tasks, plans, approvals, report };
}

export function ProjectWork({
  projectId,
  initialTasks,
  initialPlans,
  initialApprovals,
  health,
  createTask,
}: {
  projectId: string;
  initialTasks: TaskDto[];
  initialPlans: OrchestrationDto[];
  initialApprovals: number;
  health: ProjectHealthReport;
  createTask: ReactNode;
}) {
  const t = useT();
  const { tasks, plans, approvals, report } = useProjectData(
    projectId,
    { tasks: initialTasks, plans: initialPlans, approvals: initialApprovals },
    health,
  );
  const [filter, setFilter] = useState<TaskFilter>("all");
  const [query, setQuery] = useState("");
  const [shown, setShown] = useState(TASK_PAGE_SIZE);
  const heading = useRef<HTMLHeadingElement>(null);

  const facts = projectStatusFacts(tasks);
  const waitingPlans = plans.filter((plan) => plan.status === "AWAITING_APPROVAL");
  const shared = globalIssues(report.globalChecks);
  const counts = taskFilterCounts(tasks);
  const matching = filterTasks(tasks, filter, query);
  const { visible, hidden } = firstItems(matching, shown);

  const pick = (next: TaskFilter) => {
    setFilter(next);
    setShown(TASK_PAGE_SIZE);
  };
  const jump = (next: TaskFilter) => {
    pick(next);
    setQuery("");
    heading.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    heading.current?.focus({ preventScroll: true });
  };

  const needs: ReactNode[] = [];
  if (approvals > 0)
    needs.push(
      <StatusItem key="approvals" icon={<Inbox />}>
        <Link href="/approvals" className="text-primary underline-offset-2 hover:underline">
          {approvals === 1
            ? t("1 approval waiting")
            : t("{count} approvals waiting", { count: approvals })}
        </Link>
      </StatusItem>,
    );
  for (const plan of waitingPlans)
    needs.push(
      <StatusItem key={`plan-${plan.id}`} icon={<ClipboardCheck />}>
        <Link
          href={`/projects/${projectId}/plans/${plan.id}`}
          className="block truncate text-primary underline-offset-2 hover:underline"
        >
          {t("Plan to approve: {goal}", { goal: plan.goal })}
        </Link>
      </StatusItem>,
    );
  if (facts.review.length > 0)
    needs.push(
      <StatusItem key="review" icon={<CircleAlert />}>
        <LinkButton onClick={() => jump("review")}>
          {facts.review.length === 1
            ? t("1 task to review")
            : t("{count} tasks to review", { count: facts.review.length })}
        </LinkButton>
      </StatusItem>,
    );
  if (facts.recentFailures.length > 0)
    needs.push(
      <StatusItem key="failed" icon={<TriangleAlert />}>
        <LinkButton onClick={() => jump("failed")}>
          {facts.recentFailures.length === 1
            ? t("1 task failed in the last 7 days")
            : t("{count} tasks failed in the last 7 days", {
                count: facts.recentFailures.length,
              })}
        </LinkButton>
      </StatusItem>,
    );
  if (report.health !== "OK")
    needs.push(
      <StatusItem key="health" icon={<Stethoscope />}>
        <a href="#health" className="text-primary underline-offset-2 hover:underline">
          {t("Health: {summary}", { summary: checksSummary(report.checks, t) })}
        </a>
      </StatusItem>,
    );
  if (shared.length > 0)
    needs.push(
      <StatusItem key="global" icon={<CircleAlert />}>
        <Link href="/#global-health" className="text-primary underline underline-offset-2">
          {shared.length === 1
            ? t("1 problem affects every project")
            : t("{count} problems affect every project", { count: shared.length })}
        </Link>
      </StatusItem>,
    );

  return (
    <>
      <section
        className="grid grid-cols-1 gap-4 md:grid-cols-2"
        aria-label={t("Project status")}
        data-testid="project-status"
      >
        <Card className="space-y-3 p-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
            <Activity className="size-4 text-primary" aria-hidden />
            {t("Running now")}
          </h2>
          {facts.active.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("No agent is working on this project.")}
            </p>
          ) : (
            <ul className="space-y-2">
              {facts.active.slice(0, ACTIVE_SHOWN).map((task) => (
                <li key={task.id} className="flex min-w-0 items-center gap-2 text-sm">
                  <TaskStatusBadge status={task.status} />
                  <Link
                    href={`/tasks/${task.id}`}
                    className="min-w-0 truncate underline-offset-2 hover:underline"
                  >
                    {task.title}
                  </Link>
                </li>
              ))}
              {facts.active.length > ACTIVE_SHOWN ? (
                <li className="text-sm">
                  <LinkButton onClick={() => jump("active")}>
                    {t("Show all {count} active tasks", { count: facts.active.length })}
                  </LinkButton>
                </li>
              ) : null}
            </ul>
          )}
        </Card>
        <Card className="space-y-3 p-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
            <Inbox className="size-4 text-warning" aria-hidden />
            {t("Needs you")}
          </h2>
          {needs.length === 0 ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <CircleCheck className="size-4 text-success" aria-hidden />
              {t("Nothing needs you right now.")}
            </p>
          ) : (
            <ul className="space-y-2">{needs}</ul>
          )}
        </Card>
      </section>

      <section className="space-y-3" aria-labelledby="project-tasks-heading" id="tasks">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2
            id="project-tasks-heading"
            ref={heading}
            tabIndex={-1}
            className="scroll-mt-6 text-sm font-semibold tracking-tight outline-none"
          >
            {t("Tasks")}
          </h2>
          {tasks.length > 0 ? (
            <div className="relative w-full min-w-0 sm:w-56">
              <Search
                className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                type="search"
                aria-label={t("Find a task by title")}
                placeholder={t("Find a task by title")}
                className="h-9 pl-8"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setShown(TASK_PAGE_SIZE);
                }}
                data-testid="project-task-search"
              />
            </div>
          ) : null}
        </div>
        {tasks.length === 0 ? (
          <EmptyState
            icon={<ListTodo className="size-5" />}
            title={t("No tasks yet")}
            description={t("Create a task to hand work to a Claude Code agent.")}
            action={createTask}
          />
        ) : (
          <>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("Show tasks")}>
              {TASK_FILTERS.map((entry) => (
                <button
                  key={entry}
                  type="button"
                  aria-pressed={filter === entry}
                  onClick={() => pick(entry)}
                  data-testid={`project-task-filter-${entry}`}
                  className={cn(
                    "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    filter === entry
                      ? "border-primary/50 bg-primary/12 text-primary"
                      : "border-border text-muted-foreground hover:border-border-strong hover:text-foreground",
                  )}
                >
                  {t(TASK_FILTER_LABELS[entry])}
                  <span className="tabular">{counts[entry]}</span>
                </button>
              ))}
            </div>
            {visible.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                {t("No task matches. Clear the search or pick another filter.")}
              </p>
            ) : (
              <TaskRows tasks={visible} testId="project-tasks" />
            )}
            {hidden > 0 ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShown((value) => value + TASK_PAGE_SIZE)}
              >
                {t("Show {count} more", { count: Math.min(hidden, TASK_PAGE_SIZE) })}
              </Button>
            ) : null}
          </>
        )}
      </section>
    </>
  );
}
