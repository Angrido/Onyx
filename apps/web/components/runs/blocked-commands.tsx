"use client";

import type { BlockedCommandsResponse, RunTaskResponse } from "@onyx/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Play, ShieldAlert } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/form-controls";
import { api, errorMessage } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/keys";
import { defaultRules } from "@/lib/permissions";
import { cn } from "@/lib/utils";

const SHOWN_COMMANDS = 4;

export function BlockedCommands({ runId, taskId }: { runId: string; taskId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: queryKeys.runBlocked(runId),
    queryFn: () => api.get<BlockedCommandsResponse>(`/api/runs/${runId}/blocked`),
  });
  const [chosen, setChosen] = useState<string[] | null>(null);
  const [reply, setReply] = useState("");
  const rules = chosen ?? (data ? defaultRules(data.suggestions) : []);

  const allow = useMutation({
    mutationFn: () =>
      api.post<RunTaskResponse>(`/api/runs/${runId}/allow`, {
        rules,
        ...(reply.trim() ? { reply: reply.trim() } : {}),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.task(taskId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.allTasks });
      if (data) void queryClient.invalidateQueries({ queryKey: queryKeys.project(data.projectId) });
      toast.success(rules.length > 0 ? "Allowed: the task continues" : "The task continues");
      if (pathname !== `/tasks/${taskId}`) router.push(`/tasks/${taskId}`);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  if (!data || data.commands.length === 0) return null;
  const toggle = (rule: string, on: boolean) =>
    setChosen(on ? [...rules, rule] : rules.filter((entry) => entry !== rule));

  return (
    <div
      className="space-y-3 rounded-lg border border-warning/40 bg-warning/8 p-4"
      data-testid="blocked-commands"
    >
      <div className="flex items-start gap-2">
        <ShieldAlert className="mt-0.5 size-4 shrink-0 text-warning" />
        <div className="space-y-1">
          <p className="text-sm font-medium">
            The agent was not allowed to run {data.commands.length}{" "}
            {data.commands.length === 1 ? "command" : "commands"}
          </p>
          <p className="text-xs text-muted-foreground">
            Nobody can approve commands during a run, so Claude Code refused these. Allow them for
            this project and the task continues in the same session; answer the agent below if it
            asked something.
          </p>
        </div>
      </div>
      <ul className="space-y-1">
        {data.commands.slice(0, SHOWN_COMMANDS).map((command) => (
          <li
            key={command}
            className="truncate rounded bg-surface-0/70 px-2 py-1 font-mono text-[11px] text-muted-foreground"
            title={command}
          >
            {command}
          </li>
        ))}
        {data.commands.length > SHOWN_COMMANDS ? (
          <li className="text-[11px] text-muted-foreground">
            and {data.commands.length - SHOWN_COMMANDS} more
          </li>
        ) : null}
      </ul>
      <fieldset className="space-y-1.5">
        <legend className="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          Allow in this project
        </legend>
        {data.suggestions.map((suggestion) => (
          <label
            key={suggestion.rule}
            className={cn(
              "flex items-center gap-2 text-xs",
              suggestion.allowed && "text-muted-foreground",
            )}
          >
            <input
              type="checkbox"
              className="size-4 accent-[var(--primary)]"
              checked={suggestion.allowed || rules.includes(suggestion.rule)}
              disabled={suggestion.allowed}
              onChange={(event) => toggle(suggestion.rule, event.target.checked)}
            />
            <span className="font-mono">{suggestion.program}</span>
            <span className="text-muted-foreground">any command starting with it</span>
            {suggestion.allowed ? (
              <span className="text-[10px] uppercase tracking-wider">already allowed</span>
            ) : suggestion.risky ? (
              <span className="text-[10px] uppercase tracking-wider text-warning">
                can change or delete things: check first
              </span>
            ) : null}
          </label>
        ))}
      </fieldset>
      <Textarea
        aria-label="Reply to the agent"
        placeholder="Reply to the agent (optional), e.g. Yes, install Playwright. Only the invitation screens."
        className="min-h-16 text-xs"
        value={reply}
        onChange={(event) => setReply(event.target.value)}
      />
      <div className="flex justify-end">
        <Button
          size="sm"
          onClick={() => allow.mutate()}
          disabled={allow.isPending}
          data-testid="allow-and-continue"
        >
          {allow.isPending ? <Loader2 className="animate-spin" /> : <Play />}
          {rules.length > 0 ? "Allow and continue" : "Continue"}
        </Button>
      </div>
    </div>
  );
}
