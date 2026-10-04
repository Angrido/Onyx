"use client";

import type { PullRequestDraftDto, PullRequestDto, PullRequestListResponse } from "@onyx/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { GitPullRequest, Loader2, Send } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { PullRequestStatus } from "@/components/github/pull-request-status";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/form-controls";
import { api, errorMessage } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/keys";
import { useT } from "@/lib/i18n/client";

const BRANCH_EXAMPLE = "onyx/fix-login";

function DraftForm({
  projectId,
  draft,
  onOpened,
}: {
  projectId: string;
  draft: PullRequestDraftDto;
  onOpened: (pull: PullRequestDto) => void;
}) {
  const t = useT();
  const [title, setTitle] = useState(draft.title);
  const [body, setBody] = useState(draft.body);
  const [asDraft, setAsDraft] = useState(false);
  const open = useMutation({
    mutationFn: () =>
      api.post<PullRequestDto>(`/api/projects/${projectId}/github/pulls`, {
        branch: draft.branch,
        title,
        body,
        draft: asDraft,
      }),
    onSuccess: (pull) => {
      toast.success(t("Pull request #{number} is open", { number: pull.number }));
      onOpened(pull);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    open.mutate();
  }

  return (
    <form className="space-y-3" onSubmit={submit} data-testid="pull-draft">
      <p className="text-xs text-muted-foreground">
        {draft.tasks.length > 0
          ? `${
              draft.tasks.length === 1
                ? t("From 1 task published on {branch}, into {base}.", {
                    branch: draft.branch,
                    base: draft.baseBranch,
                  })
                : t("From {count} tasks published on {branch}, into {base}.", {
                    count: draft.tasks.length,
                    branch: draft.branch,
                    base: draft.baseBranch,
                  })
            } ${t("The description is built from the tasks, the diff and the test loops, without a model.")}`
          : t("No completed task was published on {branch}: the description lists the diff only.", {
              branch: draft.branch,
            })}
      </p>
      <Field label={t("Title")} htmlFor="pull-title">
        <Input
          id="pull-title"
          value={title}
          maxLength={256}
          onChange={(event) => setTitle(event.target.value)}
        />
      </Field>
      <Field label={t("Description")} htmlFor="pull-body">
        <Textarea
          id="pull-body"
          className="min-h-56 font-mono text-xs"
          value={body}
          onChange={(event) => setBody(event.target.value)}
        />
      </Field>
      <label className="flex items-center gap-2 text-sm text-muted-foreground">
        <input
          type="checkbox"
          className="size-4 accent-[var(--primary)]"
          checked={asDraft}
          onChange={(event) => setAsDraft(event.target.checked)}
        />
        {t("Open as draft")}
      </label>
      {draft.reason ? (
        <p className="text-sm text-warning" role="status">
          {draft.reason}
        </p>
      ) : null}
      <Button
        type="submit"
        disabled={!draft.canCreate || open.isPending || title.trim().length === 0}
        data-testid="pull-open"
      >
        {open.isPending ? <Loader2 className="animate-spin" /> : <Send />}
        {t("Push and open the pull request")}
      </Button>
    </form>
  );
}

export function PullRequestsCard({
  projectId,
  initial,
  branches,
  initialBranch,
  initialDraft,
}: {
  projectId: string;
  initial: PullRequestListResponse;
  branches: string[];
  initialBranch: string;
  initialDraft: PullRequestDraftDto | null;
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const [branch, setBranch] = useState(initialBranch);
  const [chosen, setChosen] = useState(initialBranch);
  useEffect(() => {
    const timer = setTimeout(() => setChosen(branch.trim()), 400);
    return () => clearTimeout(timer);
  }, [branch]);
  const pulls = useQuery({
    queryKey: queryKeys.githubPulls(projectId),
    queryFn: () => api.get<PullRequestListResponse>(`/api/projects/${projectId}/github/pulls`),
    initialData: initial,
    refetchInterval: 60_000,
  });
  const draft = useQuery({
    queryKey: queryKeys.pullDraft(projectId, chosen),
    queryFn: () =>
      api.get<PullRequestDraftDto>(
        `/api/projects/${projectId}/github/pulls/draft?branch=${encodeURIComponent(chosen)}`,
      ),
    enabled: chosen.length > 0,
    ...(initialDraft && chosen === initialBranch ? { initialData: initialDraft } : {}),
  });

  return (
    <Card id="pull-requests" data-testid="github-pulls">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <GitPullRequest className="size-4 text-primary" />
          {t("Pull requests")}
        </CardTitle>
        <CardDescription>
          {t(
            "Onyx checks the open pull requests every minute while checks run, then less often, and stops when they are merged or closed.",
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {pulls.data.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("No pull request opened from Onyx yet.")}
          </p>
        ) : (
          <ul className="space-y-4">
            {pulls.data.items.map((pull) => (
              <li key={pull.id}>
                <PullRequestStatus pull={pull} />
              </li>
            ))}
          </ul>
        )}
        {pulls.data.repo ? (
          <div className="space-y-3 border-t border-border pt-5">
            <h3 className="text-sm font-semibold">{t("New pull request")}</h3>
            <Field
              label={t("Branch")}
              htmlFor="pull-branch"
              hint={t("A branch published from the project page or by a plan.")}
            >
              <Input
                id="pull-branch"
                list="pull-branches"
                value={branch}
                onChange={(event) => setBranch(event.target.value)}
                placeholder={BRANCH_EXAMPLE}
              />
            </Field>
            <datalist id="pull-branches">
              {branches.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
            {draft.isFetching && !draft.data ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                {t("Preparing the description…")}
              </p>
            ) : draft.isError ? (
              <p className="text-sm text-destructive">{errorMessage(draft.error)}</p>
            ) : draft.data && chosen.length > 0 ? (
              <DraftForm
                key={`${draft.data.branch}:${draft.dataUpdatedAt}`}
                projectId={projectId}
                draft={draft.data}
                onOpened={() => {
                  void queryClient.invalidateQueries({ queryKey: ["github", "pulls", projectId] });
                  void queryClient.invalidateQueries({ queryKey: queryKeys.allTasks });
                }}
              />
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            {t("The project has no GitHub remote, so pull requests cannot be opened from Onyx.")}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
