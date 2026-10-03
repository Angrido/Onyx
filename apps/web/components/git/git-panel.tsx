"use client";

import type { GitStatusDto, PublishResultDto } from "@onyx/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ChevronRight,
  ExternalLink,
  GitBranch,
  GitCommitHorizontal,
  Loader2,
  Upload,
  XCircle,
} from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/form-controls";
import { GitHubMark } from "@/components/ui/github-mark";
import { api, errorMessage } from "@/lib/api/client";
import { cn } from "@/lib/utils";

export const gitStatusKey = (projectId: string) => ["git", projectId] as const;

const KIND_MARKS: Record<string, { mark: string; className: string }> = {
  added: { mark: "A", className: "text-success" },
  untracked: { mark: "U", className: "text-success" },
  modified: { mark: "M", className: "text-warning" },
  deleted: { mark: "D", className: "text-destructive" },
  renamed: { mark: "R", className: "text-info" },
  other: { mark: "?", className: "text-muted-foreground" },
};

export function GitPanel({
  projectId,
  githubConnected,
}: {
  projectId: string;
  githubConnected: boolean;
}) {
  const queryClient = useQueryClient();
  const status = useQuery({
    queryKey: gitStatusKey(projectId),
    queryFn: () => api.get<GitStatusDto>(`/api/projects/${projectId}/git`),
    refetchInterval: 10_000,
  });
  const data = status.data;
  const [branchDraft, setBranchDraft] = useState<string | null>(null);
  const [messageDraft, setMessageDraft] = useState<string | null>(null);
  const [showFiles, setShowFiles] = useState(false);
  const [result, setResult] = useState<PublishResultDto | null>(null);
  const branch =
    branchDraft ??
    (data ? (data.onDefaultBranch || !data.branch ? data.suggestedBranch : data.branch) : "");
  const message = messageDraft ?? data?.suggestedMessage ?? "";

  const store = (next: GitStatusDto) => queryClient.setQueryData(gitStatusKey(projectId), next);

  const publish = useMutation({
    mutationFn: () =>
      api.post<PublishResultDto>(`/api/projects/${projectId}/git/publish`, {
        branch: branch.trim(),
        message: message.trim(),
      }),
    onSuccess: (published) => {
      store(published.status);
      setResult(published);
      setBranchDraft(null);
      setMessageDraft(null);
      void queryClient.invalidateQueries({ queryKey: ["board", projectId] });
      if (published.pushed) toast.success(`Pushed ${published.branch} to GitHub`);
      else toast.error("Committed, but the push failed");
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const back = useMutation({
    mutationFn: () => api.post<GitStatusDto>(`/api/projects/${projectId}/git/switch-default`),
    onSuccess: (next) => {
      store(next);
      setResult(null);
      setBranchDraft(null);
      setMessageDraft(null);
      toast.success(`Back on ${next.defaultBranch}`);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  if (!data) {
    return (
      <Card className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Reading the repository…
      </Card>
    );
  }
  if (!data.isRepo) {
    return (
      <Card className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
        <GitBranch className="size-4" />
        This project folder is not a git repository.
      </Card>
    );
  }

  const canPush =
    data.changeCount > 0 || (!data.onDefaultBranch && (data.ahead > 0 || data.upstream === null));
  const compareUrl = result?.compareUrl ?? data.compareUrl;

  return (
    <Card data-testid="git-panel">
      <CardContent className="space-y-3 pt-5">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <GitBranch className="size-4 text-primary" />
          <span className="font-medium">Branch</span>
          <Badge tone={data.onDefaultBranch ? "neutral" : "primary"} data-testid="git-branch">
            {data.branch ?? "detached"}
          </Badge>
          {data.ahead > 0 ? <Badge tone="warning">{data.ahead} to push</Badge> : null}
          {data.behind > 0 ? <Badge>{data.behind} behind</Badge> : null}
          {data.githubRepo ? (
            <a
              href={`https://github.com/${data.githubRepo}`}
              target="_blank"
              rel="noreferrer"
              className="ml-auto inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
            >
              <GitHubMark className="size-3.5" />
              {data.githubRepo}
            </a>
          ) : null}
        </div>

        {data.changeCount > 0 ? (
          <div className="rounded-lg border border-border bg-surface-0/60">
            <button
              type="button"
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm"
              onClick={() => setShowFiles((value) => !value)}
              aria-expanded={showFiles}
            >
              <motion.span animate={{ rotate: showFiles ? 90 : 0 }}>
                <ChevronRight className="size-3.5 text-muted-foreground" />
              </motion.span>
              <span className="font-medium">
                {data.changeCount} {data.changeCount === 1 ? "file" : "files"} changed
              </span>
              {data.unpublishedTasks.length > 0 ? (
                <span className="truncate text-xs text-muted-foreground">
                  by {data.unpublishedTasks.map((task) => task.title).join(", ")}
                </span>
              ) : null}
            </button>
            {showFiles ? (
              <ul className="scrollbar-thin max-h-48 space-y-0.5 overflow-y-auto border-t border-border px-3 py-2 font-mono text-[11px]">
                {data.changes.map((change) => {
                  const mark = KIND_MARKS[change.kind] ?? KIND_MARKS.other;
                  return (
                    <li key={change.path} className="flex gap-2">
                      <span className={cn("w-3 shrink-0 font-semibold", mark?.className)}>
                        {mark?.mark}
                      </span>
                      <span className="truncate">{change.path}</span>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            No uncommitted changes.
            {data.lastCommit ? ` Last commit: ${data.lastCommit.subject}` : ""}
          </p>
        )}

        {canPush ? (
          <form
            className="space-y-3"
            onSubmit={(event: FormEvent<HTMLFormElement>) => {
              event.preventDefault();
              publish.mutate();
            }}
          >
            <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
              <Field
                label="New branch"
                htmlFor="git-branch"
                hint={`Created from ${data.branch ?? data.defaultBranch}; ${data.defaultBranch} stays untouched.`}
              >
                <Input
                  id="git-branch"
                  className="font-mono text-xs"
                  value={branch}
                  onChange={(event) => setBranchDraft(event.target.value)}
                  required
                />
              </Field>
              <Field label="Commit message" htmlFor="git-message">
                <Textarea
                  id="git-message"
                  className="min-h-16 text-xs"
                  value={message}
                  onChange={(event) => setMessageDraft(event.target.value)}
                  required
                />
              </Field>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit" disabled={publish.isPending || data.busy}>
                {publish.isPending ? <Loader2 className="animate-spin" /> : <Upload />}
                {data.changeCount > 0 ? "Commit and push to GitHub" : "Push to GitHub"}
              </Button>
              {data.busy ? (
                <span className="text-xs text-warning">
                  An agent is working: wait until it finishes.
                </span>
              ) : null}
              {!githubConnected && data.githubRepo ? (
                <span className="text-xs text-muted-foreground">
                  <Link href="/settings" className="text-primary hover:underline">
                    Connect GitHub
                  </Link>{" "}
                  with write access to push.
                </span>
              ) : null}
            </div>
          </form>
        ) : null}

        {result?.pushError ? (
          <p className="flex items-start gap-2 text-xs text-destructive">
            <XCircle className="mt-0.5 size-3.5 shrink-0" />
            {result.pushError}
          </p>
        ) : null}
        {result?.commit ? (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <GitCommitHorizontal className="size-3.5" />
            Commit <span className="font-mono">{result.commit.slice(0, 8)}</span> on {result.branch}
            {result.publishedTasks > 0 ? ` · ${result.publishedTasks} tasks published` : ""}
          </p>
        ) : null}

        <div className="flex flex-wrap gap-2">
          {compareUrl && data.upstream ? (
            <Button asChild size="sm" variant="secondary">
              <a href={compareUrl} target="_blank" rel="noreferrer" data-testid="git-compare">
                <ExternalLink />
                Open a pull request on GitHub
              </a>
            </Button>
          ) : null}
          {!data.onDefaultBranch && data.changeCount === 0 ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => back.mutate()}
              disabled={back.isPending || data.busy}
            >
              {back.isPending ? <Loader2 className="animate-spin" /> : <ArrowLeft />}
              Back to {data.defaultBranch}
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
