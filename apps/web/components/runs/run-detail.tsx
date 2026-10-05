"use client";

import type { BlockedCommandsResponse, RunDto, RunEventsResponse } from "@onyx/contracts";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowRight, Loader2, ShieldCheck, Square } from "lucide-react";
import Link from "next/link";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { RunConsole, type RunLiveState } from "@/components/runs/run-console";
import { StatusBanner } from "@/components/tasks/status-banner";
import { Button } from "@/components/ui/button";
import { api, errorMessage } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/keys";
import { useT } from "@/lib/i18n/client";
import { isTerminal } from "@/lib/run-feed";
import { runBanner } from "@/lib/task-guide";

export function RunDetail({
  run: initial,
  blocked,
  events,
}: {
  run: RunDto;
  blocked: BlockedCommandsResponse | null;
  events: RunEventsResponse | null;
}) {
  const t = useT();
  const [live, setLive] = useState<RunLiveState | null>(null);
  const onLive = useCallback((state: RunLiveState) => setLive(state), []);
  const { data: run = initial } = useQuery({
    queryKey: queryKeys.run(initial.id),
    queryFn: () => api.get<RunDto>(`/api/runs/${initial.id}`),
    initialData: initial,
    staleTime: Infinity,
  });
  const status = live?.status ?? run.status;
  const terminal = isTerminal(status);
  const { data: blockedData } = useQuery({
    queryKey: queryKeys.runBlocked(initial.id),
    queryFn: () => api.get<BlockedCommandsResponse>(`/api/runs/${initial.id}/blocked`),
    enabled: terminal,
    ...(blocked ? { initialData: blocked } : {}),
  });
  const abort = useMutation({
    mutationFn: () => api.post<RunDto>(`/api/runs/${initial.id}/abort`),
    onError: (error) => toast.error(errorMessage(error)),
  });
  const banner = runBanner({
    status,
    run,
    blockedCommands: terminal ? (blockedData?.commands.length ?? 0) : 0,
    activity: live?.tool ?? null,
  });

  return (
    <div className="space-y-6">
      <StatusBanner banner={banner} testId="run-status-banner">
        {banner.actions.map((action) => {
          switch (action) {
            case "abort":
              return (
                <Button
                  key={action}
                  size="sm"
                  variant="secondary"
                  disabled={abort.isPending}
                  onClick={() => abort.mutate()}
                >
                  {abort.isPending ? <Loader2 className="animate-spin" /> : <Square />}
                  {t("Stop")}
                </Button>
              );
            case "allow":
              return (
                <Button key={action} size="sm" asChild>
                  <a
                    href="#blocked-commands"
                    onClick={() => {
                      window.setTimeout(
                        () => document.getElementById("blocked-commands")?.focus(),
                        0,
                      );
                    }}
                  >
                    <ShieldCheck />
                    {t("Choose the commands")}
                  </a>
                </Button>
              );
            case "task":
              return (
                <Button key={action} size="sm" variant="secondary" asChild>
                  <Link href={`/tasks/${run.taskId}`}>
                    {t("Go to the task")}
                    <ArrowRight />
                  </Link>
                </Button>
              );
          }
        })}
      </StatusBanner>
      <RunConsole
        key={initial.id}
        run={initial}
        blocked={blocked}
        events={events}
        className="h-[78vh]"
        onLive={onLive}
      />
    </div>
  );
}
