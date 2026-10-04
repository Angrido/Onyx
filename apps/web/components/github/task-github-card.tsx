"use client";

import type { TaskDetailDto } from "@onyx/contracts";
import { ExternalLink, GitPullRequest } from "lucide-react";
import Link from "next/link";
import { PullRequestStatus } from "@/components/github/pull-request-status";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function TaskGitHubCard({ task }: { task: TaskDetailDto }) {
  if (!task.issue && !task.pullRequest && !task.branchName) return null;
  return (
    <Card data-testid="task-github">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <GitPullRequest className="size-4 text-primary" />
          GitHub
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {task.issue ? (
          <div className="space-y-1.5">
            <a
              href={task.issue.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 font-medium hover:underline"
            >
              Issue #{task.issue.number} · {task.issue.repo}
              <ExternalLink className="size-3.5 text-muted-foreground" />
            </a>
            {task.issue.labels.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {task.issue.labels.map((label) => (
                  <Badge key={label}>{label}</Badge>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
        {task.pullRequest ? (
          <PullRequestStatus pull={task.pullRequest} />
        ) : task.branchName ? (
          <div className="space-y-2">
            <p className="text-muted-foreground">
              Published on <span className="font-mono">{task.branchName}</span>, no pull request
              yet.
            </p>
            <Button asChild size="sm" variant="secondary">
              <Link
                href={`/projects/${task.projectId}/github?branch=${encodeURIComponent(task.branchName)}#pull-requests`}
              >
                <GitPullRequest />
                Open a pull request
              </Link>
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
