"use client";

import type { BlockedCommandsResponse, GrantScope, RunTaskResponse } from "@onyx/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, Loader2, Play, ShieldAlert, TriangleAlert } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Select, Textarea } from "@/components/ui/form-controls";
import { api, errorMessage } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/keys";
import { EXPIRY_OPTIONS, SCOPE_LABELS, defaultRules } from "@/lib/permissions";
import { cn } from "@/lib/utils";

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
  const [scope, setScope] = useState<GrantScope>("TASK");
  const [expiry, setExpiry] = useState<number | null>(null);
  const rules = chosen ?? (data ? defaultRules(data.suggestions) : []);

  const allow = useMutation({
    mutationFn: () =>
      api.post<RunTaskResponse>(`/api/runs/${runId}/allow`, {
        rules,
        scope,
        expiresInHours: expiry,
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
  const scopes: GrantScope[] = data.agentConfigId
    ? ["TASK", "AGENT", "PROJECT"]
    : ["TASK", "PROJECT"];

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
            Nobody can approve commands during a run, so Claude Code refused these. Allow the ones
            you trust and the task continues in the same session; answer the agent below if it asked
            something.
          </p>
        </div>
      </div>
      {data.suggestions.length > 0 ? (
        <fieldset className="space-y-2">
          <legend className="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Commands to allow
          </legend>
          {data.suggestions.map((suggestion) => (
            <label
              key={suggestion.rule}
              className={cn(
                "flex min-h-6 items-start gap-2.5 text-xs",
                suggestion.allowed && "text-muted-foreground",
              )}
            >
              <input
                type="checkbox"
                className="mt-0.5 size-4 shrink-0 accent-[var(--primary)]"
                checked={suggestion.allowed || rules.includes(suggestion.rule)}
                disabled={suggestion.allowed}
                onChange={(event) => toggle(suggestion.rule, event.target.checked)}
              />
              <span className="min-w-0 space-y-0.5">
                <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span className="font-mono">{suggestion.program} …</span>
                  {suggestion.allowed ? (
                    <span className="text-[10px] uppercase tracking-wider">already allowed</span>
                  ) : suggestion.safety === "REVIEW" ? (
                    <span className="inline-flex items-center gap-1 text-warning">
                      <TriangleAlert className="size-3" />
                      {suggestion.reason ?? "check before allowing"}
                    </span>
                  ) : suggestion.reason ? (
                    <span className="text-muted-foreground">{suggestion.reason}</span>
                  ) : null}
                </span>
                <span
                  className="block truncate font-mono text-[11px] text-muted-foreground"
                  title={suggestion.command}
                >
                  from: {suggestion.command}
                </span>
              </span>
            </label>
          ))}
        </fieldset>
      ) : null}
      {data.refused.length > 0 ? (
        <ul className="space-y-1" data-testid="refused-commands">
          {data.refused.map((entry) => (
            <li key={entry.command} className="flex items-start gap-2 text-xs">
              <Ban className="mt-0.5 size-3.5 shrink-0 text-destructive" />
              <span className="min-w-0">
                <span className="block truncate font-mono" title={entry.command}>
                  {entry.command}
                </span>
                <span className="text-muted-foreground">
                  Never allowed: {entry.program} {entry.reason}.
                </span>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {data.suggestions.some((suggestion) => !suggestion.allowed) ? (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <label className="space-y-1 text-xs">
            <span className="text-muted-foreground">Allow for</span>
            <Select
              value={scope}
              onChange={(event) => setScope(event.target.value as GrantScope)}
              data-testid="grant-scope"
            >
              {scopes.map((entry) => (
                <option key={entry} value={entry}>
                  {entry === "AGENT" && data.agentName
                    ? `Agent profile ${data.agentName}`
                    : entry === "TASK"
                      ? `This task: ${data.taskTitle}`
                      : SCOPE_LABELS[entry]}
                </option>
              ))}
            </Select>
          </label>
          <label className="space-y-1 text-xs">
            <span className="text-muted-foreground">For how long</span>
            <Select
              value={expiry === null ? "" : String(expiry)}
              onChange={(event) =>
                setExpiry(event.target.value === "" ? null : Number(event.target.value))
              }
              data-testid="grant-expiry"
            >
              {EXPIRY_OPTIONS.map((option) => (
                <option key={option.label} value={option.hours === null ? "" : option.hours}>
                  {option.label}
                </option>
              ))}
            </Select>
          </label>
        </div>
      ) : null}
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
