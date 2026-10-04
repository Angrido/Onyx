"use client";

import type { PullRequestDto } from "@onyx/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RelativeTime } from "@/components/ui/relative-time";
import { api, errorMessage } from "@/lib/api/client";
import {
  CHECK_RESULT_LABELS,
  CHECK_RESULT_TONES,
  CHECKS_LABELS,
  CHECKS_TONES,
  PULL_STATE_LABELS,
  PULL_STATE_TONES,
  checksCount,
} from "@/lib/github";

export function PullRequestStatus({
  pull,
  onRefreshed,
}: {
  pull: PullRequestDto;
  onRefreshed?: (pull: PullRequestDto) => void;
}) {
  const queryClient = useQueryClient();
  const refresh = useMutation({
    mutationFn: () => api.post<PullRequestDto>(`/api/pull-requests/${pull.id}/refresh`),
    onSuccess: (next) => {
      onRefreshed?.(next);
      void queryClient.invalidateQueries({ queryKey: ["github", "pulls", pull.projectId] });
      void queryClient.invalidateQueries({ queryKey: ["task"] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <div className="space-y-2" data-testid="pull-request">
      <div className="flex flex-wrap items-center gap-2">
        <a
          href={pull.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-sm font-medium hover:underline"
        >
          #{pull.number} {pull.title}
          <ExternalLink className="size-3.5 text-muted-foreground" />
        </a>
        <Badge tone={PULL_STATE_TONES[pull.state]}>{PULL_STATE_LABELS[pull.state]}</Badge>
        {pull.draft ? <Badge>Draft</Badge> : null}
        <Badge tone={CHECKS_TONES[pull.checksState]} data-testid="pull-checks">
          {CHECKS_LABELS[pull.checksState]}
        </Badge>
      </div>
      <p className="text-xs text-muted-foreground">
        <span className="font-mono">{pull.branch}</span> → {pull.baseBranch} · {checksCount(pull)}
        {pull.checkedAt ? (
          <>
            {" "}
            · checked <RelativeTime iso={pull.checkedAt} />
          </>
        ) : null}
      </p>
      {pull.checks.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5" aria-label={`Checks of pull request ${pull.number}`}>
          {pull.checks.map((check) => (
            <li key={check.name}>
              {check.url ? (
                <a href={check.url} target="_blank" rel="noreferrer">
                  <Badge tone={CHECK_RESULT_TONES[check.result]}>
                    {check.name}: {CHECK_RESULT_LABELS[check.result]}
                  </Badge>
                </a>
              ) : (
                <Badge tone={CHECK_RESULT_TONES[check.result]}>
                  {check.name}: {CHECK_RESULT_LABELS[check.result]}
                </Badge>
              )}
            </li>
          ))}
        </ul>
      ) : null}
      {pull.state === "OPEN" ? (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => refresh.mutate()}
          disabled={refresh.isPending}
          aria-label={`Check pull request ${pull.number} again`}
        >
          {refresh.isPending ? <Loader2 className="animate-spin" /> : <RefreshCw />}
          Check now
        </Button>
      ) : null}
    </div>
  );
}
