"use client";

import type { QueueDto, QueueSettings } from "@onyx/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ListOrdered, Loader2, Save } from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/form-controls";
import { api, errorMessage } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/keys";
import { useT } from "@/lib/i18n/client";
import { useQueue } from "@/lib/live";
import { AGING_OPTIONS, limitOptions, projectLimitLabel } from "@/lib/queue";

export function QueueCard({ initial }: { initial: QueueDto }) {
  const t = useT();
  const queryClient = useQueryClient();
  const { data: queue = initial } = useQueue(initial);
  const [projectLimit, setProjectLimit] = useState<number | null>(queue.settings.projectLimit);
  const [agingMinutes, setAgingMinutes] = useState(queue.settings.agingMinutes);
  const options = limitOptions(queue.maxConcurrent);
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
          <div className="space-y-2 border-t border-border pt-4">
            <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              {t("Per project")}
            </p>
            <ul className="space-y-2">
              {queue.projects.map((project) => (
                <li
                  key={project.projectId}
                  className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1"
                >
                  <span className="min-w-0 text-sm">
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
                    onChange={(event) =>
                      setOwn.mutate({
                        projectId: project.projectId,
                        limit: event.target.value === "" ? null : Number(event.target.value),
                      })
                    }
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
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
