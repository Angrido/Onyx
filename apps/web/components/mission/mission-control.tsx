"use client";

import type { MissionControlDto, MissionProjectDto } from "@onyx/contracts";
import {
  Bot,
  CircleDollarSign,
  FlaskConical,
  FolderGit2,
  GitBranch,
  Inbox,
  Search,
} from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { RunStatusBadge } from "@/components/tasks/status-badge";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/form-controls";
import { RelativeTime } from "@/components/ui/relative-time";
import { EmptyState } from "@/components/ui/skeleton";
import { formatTokens, formatUsd } from "@/lib/format";
import { useMission } from "@/lib/live";
import {
  FILTER_LABELS,
  HEALTH_STYLES,
  MISSION_FILTERS,
  MISSION_SORTS,
  SORT_LABELS,
  filterCounts,
  filterProjects,
  gitLine,
  sortProjects,
  type MissionFilter,
  type MissionSort,
} from "@/lib/mission";
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

function ProjectCard({ project }: { project: MissionProjectDto }) {
  const health = HEALTH_STYLES[project.health];
  return (
    <Card className="flex h-full flex-col gap-3 p-4" data-testid="mission-card">
      <div className="flex items-start justify-between gap-3">
        <Link
          href={`/projects/${project.id}`}
          className="min-w-0 truncate text-base font-semibold tracking-tight hover:underline"
        >
          {project.name}
        </Link>
        <Badge tone={health.tone} data-testid="mission-health">
          <span className={cn("size-1.5 rounded-full", health.dot)} aria-hidden />
          {health.label}
        </Badge>
      </div>
      <div className="space-y-2">
        <Row icon={<GitBranch />}>
          <span className="block truncate font-mono" title={project.git.error ?? undefined}>
            {gitLine(project)}
          </span>
        </Row>
        <Row icon={<Bot />}>
          <span>
            {project.running > 0 ? (
              <span className="font-medium text-foreground">{project.running} running</span>
            ) : (
              <span className="text-muted-foreground">No agent running</span>
            )}
            {project.queued > 0 ? ` · ${project.queued} queued` : ""}
            {project.runLimit !== null ? ` · limit ${project.runLimit}` : ""}
            {project.openTasks > 0 ? ` · ${project.openTasks} open tasks` : ""}
          </span>
          {project.activeTasks.length > 0 ? (
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
          ) : null}
        </Row>
        {project.lastRun ? (
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
        {project.lastTdd ? (
          <Row icon={<FlaskConical />}>
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
              <Badge tone={TDD_STATUS_TONES[project.lastTdd.status]}>
                TDD {TDD_STATUS_LABELS[project.lastTdd.status].toLowerCase()}
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
        <Row icon={<CircleDollarSign />}>
          <span className="tabular">
            Today {formatUsd(project.today.costUsd)} · {formatTokens(project.today.tokens)} tokens
            <span className="text-muted-foreground"> · week {formatUsd(project.week.costUsd)}</span>
          </span>
        </Row>
        {project.pendingApprovals > 0 ? (
          <Row icon={<Inbox />}>
            <Link href="/approvals" className="font-medium text-warning hover:underline">
              {project.pendingApprovals} {project.pendingApprovals === 1 ? "approval" : "approvals"}{" "}
              waiting
            </Link>
          </Row>
        ) : null}
      </div>
      {project.reasons.length > 0 ? (
        <ul
          className="mt-auto space-y-0.5 border-t border-border pt-2 text-xs text-muted-foreground"
          aria-label={`Why ${project.name} needs attention`}
        >
          {project.reasons.map((reason) => (
            <li key={reason} className="break-words">
              {reason}
            </li>
          ))}
        </ul>
      ) : null}
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
        title="No projects yet"
        description="Register a repository or import one from GitHub: each project gets a card here with its branch, agents, spend and health."
        action={emptyAction}
      />
    );
  }

  return (
    <section className="space-y-3" aria-labelledby="mission-heading" data-testid="mission-control">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="mission-heading" className="text-sm font-semibold tracking-tight">
            Projects
          </h2>
          <p className="text-xs text-muted-foreground" data-testid="mission-summary">
            {data.running} of {data.maxConcurrent} agents running · {data.queued} queued · today{" "}
            {formatUsd(data.today.costUsd)} · this week {formatUsd(data.week.costUsd)}
          </p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <div className="relative min-w-0 flex-1 sm:w-48 sm:flex-none">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              aria-label="Find a project"
              placeholder="Find a project"
              className="h-9 pl-8"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <Select
            aria-label="Sort projects"
            className="h-9 w-auto"
            value={sort}
            onChange={(event) => setSort(event.target.value as MissionSort)}
            data-testid="mission-sort"
          >
            {MISSION_SORTS.map((entry) => (
              <option key={entry} value={entry}>
                {SORT_LABELS[entry]}
              </option>
            ))}
          </Select>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Show projects">
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
            {FILTER_LABELS[entry]}
            <span className="tabular opacity-80">{counts[entry]}</span>
          </button>
        ))}
      </div>
      {shown.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          No project matches. Clear the search or pick another filter.
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
