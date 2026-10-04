"use client";

import type { GitHubIssueListResponse, ImportIssuesResponse, WorkspaceDto } from "@onyx/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleDot, Download, ExternalLink, Loader2, ShieldAlert } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Select } from "@/components/ui/form-controls";
import { RelativeTime } from "@/components/ui/relative-time";
import { Skeleton } from "@/components/ui/skeleton";
import { api, errorMessage } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/keys";
import { toggleNumber } from "@/lib/github";
import { useT } from "@/lib/i18n/client";

export function IssuesCard({
  projectId,
  workspaces,
  initial,
}: {
  projectId: string;
  workspaces: WorkspaceDto[];
  initial: GitHubIssueListResponse | null;
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<number[]>([]);
  const [workspaceId, setWorkspaceId] = useState("");
  const issues = useQuery({
    queryKey: queryKeys.githubIssues(projectId, page),
    queryFn: () =>
      api.get<GitHubIssueListResponse>(`/api/projects/${projectId}/github/issues?page=${page}`),
    ...(initial && page === 1 ? { initialData: initial } : {}),
  });
  const importing = useMutation({
    mutationFn: () =>
      api.post<ImportIssuesResponse>(`/api/projects/${projectId}/github/issues/import`, {
        numbers: selected,
        ...(workspaceId ? { workspaceId } : {}),
      }),
    onSuccess: (result) => {
      setSelected([]);
      if (result.items.length > 0)
        toast.success(
          result.items.length === 1
            ? t("1 issue is now a draft task")
            : t("{count} issues are now draft tasks", { count: result.items.length }),
        );
      for (const skipped of result.skipped)
        toast.info(t("#{number}: {reason}", { number: skipped.number, reason: skipped.reason }));
      void queryClient.invalidateQueries({ queryKey: ["github", "issues", projectId] });
      void queryClient.invalidateQueries({ queryKey: queryKeys.allTasks });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const data = issues.data;
  return (
    <Card data-testid="github-issues">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CircleDot className="size-4 text-primary" />
          {t("Issues")}
        </CardTitle>
        <CardDescription className="flex items-start gap-1.5">
          <ShieldAlert className="mt-0.5 size-3.5 shrink-0 text-warning" />
          {t(
            "Imported issues become draft tasks. Their text comes from GitHub, not from you: the prompt tells the agent to treat it as a description, and you review it before running.",
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {issues.isPending ? (
          <div className="space-y-2">
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
          </div>
        ) : issues.isError ? (
          <p className="text-sm text-destructive">{errorMessage(issues.error)}</p>
        ) : !data?.repo ? (
          <p className="text-sm text-muted-foreground">
            {t("The project has no GitHub remote: issues appear when")} <code>origin</code>{" "}
            {t("points to GitHub.")}
          </p>
        ) : data.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("No open issues on {repo}.", { repo: data.repo })}
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {data.items.map((issue) => {
              const id = `issue-${issue.number}`;
              return (
                <li
                  key={issue.number}
                  className="flex items-start gap-3 py-3"
                  data-testid="issue-row"
                >
                  <input
                    id={id}
                    type="checkbox"
                    className="mt-1 size-4 accent-[var(--primary)]"
                    checked={selected.includes(issue.number)}
                    disabled={issue.importedTaskId !== null}
                    onChange={() => setSelected((current) => toggleNumber(current, issue.number))}
                  />
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <label htmlFor={id} className="text-sm font-medium">
                        #{issue.number} {issue.title}
                      </label>
                      {issue.labels.map((label) => (
                        <Badge key={label}>{label}</Badge>
                      ))}
                    </div>
                    {issue.excerpt ? (
                      <p className="line-clamp-2 text-xs text-muted-foreground">{issue.excerpt}</p>
                    ) : null}
                    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      <span>
                        {issue.author ?? t("unknown")} · {t("updated")}{" "}
                        <RelativeTime iso={issue.updatedAt} />
                      </span>
                      <a
                        href={issue.url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 underline underline-offset-2"
                      >
                        {t("On GitHub")}
                        <ExternalLink className="size-3" />
                      </a>
                      {issue.importedTaskId ? (
                        <Link
                          href={`/tasks/${issue.importedTaskId}`}
                          className="text-primary underline underline-offset-2"
                        >
                          {t("Imported task")}
                        </Link>
                      ) : null}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {data?.repo ? (
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
            <Field label={t("Workspace")} htmlFor="issue-workspace">
              <Select
                id="issue-workspace"
                value={workspaceId}
                onChange={(event) => setWorkspaceId(event.target.value)}
              >
                <option value="">{t("Auto (from the issue)")}</option>
                {workspaces.map((workspace) => (
                  <option key={workspace.id} value={workspace.id}>
                    {workspace.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Button
              onClick={() => importing.mutate()}
              disabled={selected.length === 0 || importing.isPending}
              data-testid="issues-import"
            >
              {importing.isPending ? <Loader2 className="animate-spin" /> : <Download />}
              {selected.length > 0
                ? t("Import {count} as tasks", { count: selected.length })
                : t("Import as tasks")}
            </Button>
            <div className="flex gap-2 sm:ml-auto">
              <Button
                variant="ghost"
                size="sm"
                disabled={page === 1}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
              >
                {t("Previous")}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={!data.hasNext}
                onClick={() => setPage((current) => current + 1)}
              >
                {t("Next")}
              </Button>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
