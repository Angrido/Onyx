"use client";

import type { QueueDto, QueueSettings } from "@onyx/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, ListOrdered, Loader2, Save, Search } from "lucide-react";
import { useId, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/form-controls";
import { api, errorMessage } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/keys";
import { useT } from "@/lib/i18n/client";
import { useQueue } from "@/lib/live";
import { AGING_OPTIONS, limitOptions, projectLimitLabel } from "@/lib/queue";
import { QUEUE_SEARCH_THRESHOLD, visibleQueueProjects } from "@/lib/settings-sections";

export function QueueCard({ initial }: { initial: QueueDto }) {
  const t = useT();
  const queryClient = useQueryClient();
  const { data: queue = initial } = useQueue(initial);
  const [projectLimit, setProjectLimit] = useState<number | null>(queue.settings.projectLimit);
  const [agingMinutes, setAgingMinutes] = useState(queue.settings.agingMinutes);
  const [showAll, setShowAll] = useState(false);
  const [query, setQuery] = useState("");
  const [keep, setKeep] = useState<ReadonlySet<string>>(new Set());
  const listId = useId();
  const options = limitOptions(queue.maxConcurrent);
  const customized = queue.projects.filter((project) => project.ownLimit !== null).length;
  const visible = visibleQueueProjects(queue.projects, { showAll, query, keep });
  const store = (next: QueueDto) => queryClient.setQueryData(queryKeys.queue, next);

  const save = useMutation({
    mutationFn: (settings: QueueSettings) => api.put<QueueDto>("/api/queue/settings", settings),
    onSuccess: (next) => {
      store(next);
      toast.success(t("Queue settings saved"));
    },
    onError: (error) => toast.error(errorMessage(error, t)),
  });
  const setOwn = useMutation({
    mutationFn: ({ projectId, limit }: { projectId: string; limit: number | null }) =>
      api.put<QueueDto>(`/api/queue/projects/${projectId}`, { limit }),
    onSuccess: store,
    onError: (error) => toast.error(errorMessage(error, t)),
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    save.mutate({ projectLimit, agingMinutes });
  }

  return (
    <Card id="queue" data-testid="queue-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ListOrdered className="size-4 text-primary" />
          {t("Run queue")}
        </CardTitle>
        <CardDescription>
          {queue.maxConcurrent === 1
            ? t("Onyx runs up to 1 agent at a time across all projects.")
            : t("Onyx runs up to {count} agents at a time across all projects.", {
                count: queue.maxConcurrent,
              })}{" "}
          {t(
            "Limit how many one project can take, so a long batch does not hold every slot, and let waiting tasks move up over time.",
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form className="space-y-3" onSubmit={submit}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-xs">
              <span className="text-muted-foreground">{t("Runs per project")}</span>
              <Select
                value={projectLimit === null ? "" : String(projectLimit)}
                onChange={(event) =>
                  setProjectLimit(event.target.value === "" ? null : Number(event.target.value))
                }
                data-testid="queue-project-limit"
              >
                <option value="">{t("No limit")}</option>
                {options.map((value) => (
                  <option key={value} value={value}>
                    {t("At most {count}", { count: value })}
                  </option>
                ))}
              </Select>
            </label>
            <label className="space-y-1 text-xs">
              <span className="text-muted-foreground">{t("Raise waiting tasks by one level")}</span>
              <Select
                value={String(agingMinutes)}
                onChange={(event) => setAgingMinutes(Number(event.target.value))}
                data-testid="queue-aging"
              >
                {AGING_OPTIONS.map((option) => (
                  <option key={option.minutes} value={option.minutes}>
                    {t(option.label)}
                  </option>
                ))}
              </Select>
            </label>
          </div>
          <Button size="sm" variant="secondary" disabled={save.isPending}>
            {save.isPending ? <Loader2 className="animate-spin" /> : <Save />}
            {t("Save")}
          </Button>
        </form>
        {queue.projects.length > 0 ? (
          <div className="space-y-3 border-t border-border pt-4">
            <div className="space-y-1">
              <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                {t("Per project")}
              </p>
              <p className="text-xs text-muted-foreground">
                {customized === 0
                  ? t("Every project uses the limit above.")
                  : customized === 1
                    ? t("1 project has its own limit; the others use the one above.")
                    : t("{count} projects have their own limit; the others use the one above.", {
                        count: customized,
                      })}
              </p>
            </div>
            {showAll && queue.projects.length > QUEUE_SEARCH_THRESHOLD ? (
              <div className="relative">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden="true"
                />
                <Input
                  type="search"
                  aria-label={t("Search projects")}
                  placeholder={t("Search projects")}
                  className="pl-9"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  data-testid="queue-project-search"
                />
              </div>
            ) : null}
            {visible.length > 0 ? (
              <ul id={listId} className="space-y-2">
                {visible.map((project) => (
                  <li
                    key={project.projectId}
                    className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1"
                  >
                    <span className="min-w-0 flex-1 text-sm">
                      <span className="block truncate font-medium">{project.projectName}</span>
                      <span className="text-xs text-muted-foreground">
                        {t("{running} running · {queued} queued", {
                          running: project.running,
                          queued: project.queued,
                        })}{" "}
                        · {projectLimitLabel(project.limit, t)}
                      </span>
                    </span>
                    <Select
                      aria-label={t("Run limit for {project}", { project: project.projectName })}
                      className="h-9 w-40"
                      value={project.ownLimit === null ? "" : String(project.ownLimit)}
                      disabled={setOwn.isPending}
                      onChange={(event) => {
                        const projectId = project.projectId;
                        setKeep((current) => new Set(current).add(projectId));
                        setOwn.mutate({
                          projectId,
                          limit: event.target.value === "" ? null : Number(event.target.value),
                        });
                      }}
                    >
                      <option value="">{t("Default")}</option>
                      {options.map((value) => (
                        <option key={value} value={value}>
                          {t("At most {count}", { count: value })}
                        </option>
                      ))}
                    </Select>
                  </li>
                ))}
              </ul>
            ) : showAll ? (
              <p id={listId} className="text-xs text-muted-foreground">
                {t("No project matches “{query}”.", { query: query.trim() })}
              </p>
            ) : null}
            {queue.projects.length > customized || showAll ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-expanded={showAll}
                aria-controls={visible.length > 0 || showAll ? listId : undefined}
                onClick={() => {
                  setShowAll((value) => !value);
                  setQuery("");
                  setKeep(new Set());
                }}
                data-testid="queue-show-all"
              >
                {showAll ? <ChevronUp /> : <ChevronDown />}
                {showAll
                  ? t("Show only the projects with their own limit")
                  : t("Show all the projects ({count})", { count: queue.projects.length })}
              </Button>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
