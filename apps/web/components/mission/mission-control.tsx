"use client";

import type { MissionControlDto, MissionProjectDto } from "@onyx/contracts";
import {
  Bot,
  ChevronDown,
  CircleDollarSign,
  FlaskConical,
  FolderGit2,
  GitBranch,
  Inbox,
  Search,
} from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { HealthCheckList, HealthLights } from "@/components/system/health-checks";
import { RunStatusBadge } from "@/components/tasks/status-badge";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/form-controls";
import { RelativeTime } from "@/components/ui/relative-time";
import { EmptyState } from "@/components/ui/skeleton";
import { formatUsd } from "@/lib/format";
import { useT } from "@/lib/i18n/client";
import { useMission } from "@/lib/live";
import {
  FILTER_LABELS,
  HEALTH_STYLES,
  MISSION_FILTERS,
  MISSION_SORTS,
  SORT_LABELS,
  activityLine,
  filterCounts,
  filterProjects,
  gitLine,
  isQuiet,
  lastTaskAt,
  sortProjects,
  spendLine,
  type MissionFilter,
  type MissionSort,
} from "@/lib/mission";
import { checksSummary, otherReasons } from "@/lib/system";
import { TDD_STATUS_LABELS, TDD_STATUS_TONES } from "@/lib/tdd";
import { cn } from "@/lib/utils";

function Row({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-w-0 items-start gap-2 text-xs">
      <span className="mt-0.5 shrink-0 text-muted-foreground [&_svg]:size-3.5">{icon}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

function ActiveTasks({ project }: { project: MissionProjectDto }) {
  if (project.activeTasks.length === 0) return null;
  return (
    <ul className="mt-1 space-y-0.5">
      {project.activeTasks.map((task) => (
        <li key={task.taskId} className="truncate">
          <Link
            href={task.runId ? `/runs/${task.runId}` : `/tasks/${task.taskId}`}
            className="text-primary hover:underline"
          >
            {task.title}
          </Link>
        </li>
      ))}
    </ul>
  );
}

function IdleLine({ project }: { project: MissionProjectDto }) {
  const t = useT();
  const last = lastTaskAt(project);
  return (
    <span className="text-muted-foreground" data-testid="mission-idle">
      {t("Inactive")}
      {" · "}
      {last ? (
        <>
          {t("last task")} <RelativeTime iso={last} />
        </>
      ) : (
        t("no task yet")
      )}
      {project.openTasks === 1 ? ` · ${t("1 open task")}` : ""}
      {project.openTasks > 1 ? ` · ${t("{count} open tasks", { count: project.openTasks })}` : ""}
    </span>
  );
}

function ProjectCard({ project }: { project: MissionProjectDto }) {
  const t = useT();
  const health = HEALTH_STYLES[project.health];
  const reasons = otherReasons(project);
  const quiet = isQuiet(project);
  const spend = spendLine(project, t);
  return (
    <Card
      className="flex h-full flex-col gap-3 p-4"
      data-testid="mission-card"
      data-quiet={quiet ? "true" : undefined}
    >
      <div className="flex items-start justify-between gap-3">
        <Link
          href={`/projects/${project.id}`}
          className="min-w-0 truncate text-base font-semibold tracking-tight hover:underline"
        >
          {project.name}
        </Link>
        <Badge tone={health.tone} data-testid="mission-health">
          <span className={cn("size-1.5 rounded-full", health.dot)} aria-hidden />
          {t(health.label)}
        </Badge>
      </div>
      <div className="space-y-2">
        <Row icon={<GitBranch />}>
          <span className="block truncate font-mono" title={project.git.error ?? undefined}>
            {gitLine(project, t)}
          </span>
        </Row>
        <Row icon={<Bot />}>
          {quiet ? (
            <IdleLine project={project} />
          ) : (
            <>
              <span className={project.running > 0 ? "font-medium" : "text-muted-foreground"}>
                {activityLine(project, t)}
              </span>
              <ActiveTasks project={project} />
            </>
          )}
        </Row>
        {!quiet && project.lastRun ? (
          <Row icon={<FolderGit2 />}>
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
              <RunStatusBadge status={project.lastRun.status} />
              <Link
                href={`/runs/${project.lastRun.runId}`}
                className="min-w-0 truncate hover:underline"
              >
                {project.lastRun.title}
              </Link>
              <RelativeTime
                iso={project.lastRun.endedAt ?? project.lastRun.startedAt}
                className="text-muted-foreground"
              />
            </div>
          </Row>
        ) : null}
        {!quiet && project.lastTdd ? (
          <Row icon={<FlaskConical />}>
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
              <Badge tone={TDD_STATUS_TONES[project.lastTdd.status]}>
                TDD {t(TDD_STATUS_LABELS[project.lastTdd.status]).toLowerCase()}
              </Badge>
              <Link
                href={`/tasks/${project.lastTdd.taskId}`}
                className="min-w-0 truncate hover:underline"
              >
                {project.lastTdd.title}
              </Link>
            </div>
          </Row>
        ) : null}
        {spend ? (
          <Row icon={<CircleDollarSign />}>
            <span className="tabular" data-testid="mission-spend">
              {spend}
            </span>
          </Row>
        ) : null}
        {project.pendingApprovals > 0 ? (
          <Row icon={<Inbox />}>
            <Link href="/approvals" className="font-medium text-warning hover:underline">
              {project.pendingApprovals === 1
                ? t("1 approval waiting")
                : t("{count} approvals waiting", { count: project.pendingApprovals })}
            </Link>
          </Row>
        ) : null}
      </div>
      <div className="mt-auto space-y-2 border-t border-border pt-2 text-xs">
        {reasons.length > 0 ? (
          <ul
            className="space-y-0.5 text-muted-foreground"
            aria-label={t("Why {project} needs attention", { project: project.name })}
          >
            {reasons.map((reason) => (
              <li key={reason} className="break-words">
                {reason}
              </li>
            ))}
          </ul>
        ) : null}
        {project.checks.length > 0 ? (
          <details className="group" data-testid="mission-checks">
            <summary className="-mx-1 flex cursor-pointer list-none items-center gap-2 rounded-md px-1 py-0.5 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
              <HealthLights checks={project.checks} />
              <span className="min-w-0 truncate">
                {t("Health: {summary}", { summary: checksSummary(project.checks, t) })}
              </span>
              <ChevronDown
                className="ml-auto size-3.5 shrink-0 transition-transform group-open:rotate-180"
                aria-hidden
              />
            </summary>
            <HealthCheckList checks={project.checks} className="mt-2" />
          </details>
        ) : null}
      </div>
    </Card>
  );
}

export function MissionControl({
  initial,
  emptyAction,
}: {
  initial: MissionControlDto;
  emptyAction: ReactNode;
}) {
  const t = useT();
  const { data = initial } = useMission(initial);
  const [filter, setFilter] = useState<MissionFilter>("all");
  const [sort, setSort] = useState<MissionSort>("activity");
  const [query, setQuery] = useState("");
  const counts = filterCounts(data.projects);
  const shown = sortProjects(filterProjects(data.projects, filter, query), sort);

  if (data.projects.length === 0) {
    return (
      <EmptyState
        icon={<FolderGit2 className="size-5" />}
        title={t("No projects yet")}
        description={t(
          "Register a repository or import one from GitHub: each project gets a card here with its branch, agents, spend and health.",
        )}
        action={emptyAction}
      />
    );
  }

  return (
    <section className="space-y-3" aria-labelledby="mission-heading" data-testid="mission-control">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="mission-heading" className="text-sm font-semibold tracking-tight">
            {t("Projects")}
          </h2>
          <p className="text-xs text-muted-foreground" data-testid="mission-summary">
            {t(
              "{running} of {max} agents running · {queued} queued · today {today} · this week {week}",
              {
                running: data.running,
                max: data.maxConcurrent,
                queued: data.queued,
                today: formatUsd(data.today.costUsd),
                week: formatUsd(data.week.costUsd),
              },
            )}
          </p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <div className="relative min-w-0 flex-1 sm:w-48 sm:flex-none">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              aria-label={t("Find a project")}
              placeholder={t("Find a project")}
              className="h-9 pl-8"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <Select
            aria-label={t("Sort projects")}
            className="h-9 w-auto"
            value={sort}
            onChange={(event) => setSort(event.target.value as MissionSort)}
            data-testid="mission-sort"
          >
            {MISSION_SORTS.map((entry) => (
              <option key={entry} value={entry}>
                {t(SORT_LABELS[entry])}
              </option>
            ))}
          </Select>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("Show projects")}>
        {MISSION_FILTERS.map((entry) => (
          <button
            key={entry}
            type="button"
            aria-pressed={filter === entry}
            onClick={() => setFilter(entry)}
            data-testid={`mission-filter-${entry}`}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors",
              filter === entry
                ? "border-primary/50 bg-primary/12 text-primary"
                : "border-border text-muted-foreground hover:border-border-strong hover:text-foreground",
            )}
          >
            {t(FILTER_LABELS[entry])}
            <span className="tabular">{counts[entry]}</span>
          </button>
        ))}
      </div>
      {shown.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          {t("No project matches. Clear the search or pick another filter.")}
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {shown.map((project) => (
            <ProjectCard key={project.id} project={project} />
          ))}
        </div>
      )}
    </section>
  );
}
