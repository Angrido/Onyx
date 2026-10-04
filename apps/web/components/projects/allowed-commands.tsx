"use client";

import type { AllowedToolsResponse, CommandGrantDto, ProjectStackDto } from "@onyx/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Clock, Loader2, Plus, Sparkles, Terminal, TriangleAlert, X } from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/form-controls";
import { api, errorMessage } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/keys";
import { formatRelative } from "@/lib/format";
import { useT } from "@/lib/i18n/client";
import type { Translate } from "@/lib/i18n/core";
import { ruleFor, ruleProgram } from "@/lib/permissions";

const STACK_LABELS: Record<string, string> = {
  node: "Node.js",
  python: "Python",
  go: "Go",
  rust: "Rust",
  make: "make",
  docker: "Docker",
};

const COMMAND_EXAMPLE = "npm install";

function StackSuggestions({
  stack,
  pending,
  onAllow,
}: {
  stack: ProjectStackDto;
  pending: boolean;
  onAllow: (rules: string[]) => void;
}) {
  const t = useT();
  const open = stack.commands.filter((command) => !command.allowed);
  const [unchecked, setUnchecked] = useState<Set<string>>(
    () => new Set(open.filter((command) => command.risky).map((command) => command.rule)),
  );
  if (stack.commands.length === 0) return null;
  const chosen = open
    .filter((command) => !unchecked.has(command.rule))
    .map((command) => command.rule);
  const label = stack.stacks
    .map((name) =>
      name === "node" && stack.packageManager
        ? `${STACK_LABELS[name] ?? name} (${stack.packageManager})`
        : (STACK_LABELS[name] ?? name),
    )
    .join(" · ");
  return (
    <div
      className="space-y-2 rounded-lg border border-border bg-surface-0/60 p-3 text-xs"
      data-testid="stack-commands"
    >
      <p className="flex items-center gap-2 font-medium">
        <Sparkles className="size-3.5 text-primary" />
        {t("Suggested for this project · {label}", { label })}
      </p>
      <p className="text-muted-foreground">
        {stack.continuationRuns > 0
          ? `${
              stack.continuationRuns === 1
                ? t("1 run was spent in the last {days} days continuing after a refused command.", {
                    days: stack.windowDays,
                  })
                : t(
                    "{count} runs were spent in the last {days} days continuing after a refused command.",
                    { count: stack.continuationRuns, days: stack.windowDays },
                  )
            } `
          : ""}
        {t(
          "Allowing them now saves the runs that would stop on a refused command. Commands that install packages or build images are not selected: they can run code from outside the project.",
        )}
      </p>
      <ul className="space-y-1">
        {stack.commands.map((command) => (
          <li key={command.rule}>
            <label className="flex min-h-6 flex-wrap items-center gap-x-2.5 gap-y-0.5">
              {command.allowed ? (
                <Check className="size-4 text-success" aria-label={t("Already allowed")} />
              ) : (
                <input
                  type="checkbox"
                  className="size-4 accent-[var(--primary)]"
                  checked={!unchecked.has(command.rule)}
                  onChange={(event) => {
                    const next = new Set(unchecked);
                    if (event.target.checked) next.delete(command.rule);
                    else next.add(command.rule);
                    setUnchecked(next);
                  }}
                />
              )}
              <span className="whitespace-nowrap font-mono">{command.command}</span>
              {command.risky ? (
                <span className="inline-flex items-center gap-1 whitespace-nowrap text-warning">
                  <TriangleAlert className="size-3" />
                  {t("runs third-party code")}
                </span>
              ) : null}
              <span className="w-full min-w-0 truncate pl-6.5 text-muted-foreground sm:w-auto sm:flex-1 sm:pl-0">
                {command.reason}
              </span>
            </label>
          </li>
        ))}
      </ul>
      {open.length > 0 ? (
        <Button
          size="sm"
          variant="secondary"
          disabled={pending || chosen.length === 0}
          onClick={() => onAllow(chosen)}
        >
          {pending ? <Loader2 className="animate-spin" /> : <Check />}
          {t("Allow {count} selected", { count: chosen.length })}
        </Button>
      ) : null}
    </div>
  );
}

function grantScope(grant: CommandGrantDto, t: Translate): string {
  if (grant.scope === "TASK") return t("task {title}", { title: grant.taskTitle ?? t("removed") });
  if (grant.scope === "AGENT") return t("agent {name}", { name: grant.agentName ?? t("removed") });
  return t("whole project");
}

function Grants({ projectId, initial }: { projectId: string; initial: CommandGrantDto[] }) {
  const t = useT();
  const [grants, setGrants] = useState(initial);
  const revoke = useMutation({
    mutationFn: (id: string) => api.delete(`/api/projects/${projectId}/command-grants/${id}`),
    onSuccess: (_result, id) => setGrants((current) => current.filter((grant) => grant.id !== id)),
    onError: (error) => toast.error(errorMessage(error)),
  });
  if (grants.length === 0) return null;
  return (
    <div className="space-y-1.5" data-testid="command-grants">
      <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {t("Allowed for one task, one agent or for a while")}
      </p>
      <ul className="space-y-1">
        {grants.map((grant) => (
          <li key={grant.id} className="flex items-center gap-2 text-xs">
            <span className="font-mono">{ruleProgram(grant.rule)}</span>
            <span className="min-w-0 truncate text-muted-foreground">
              {grantScope(grant, t)}
              {grant.expiresAt ? (
                <>
                  {" · "}
                  <Clock className="inline size-3" />{" "}
                  {t("ends {when}", { when: formatRelative(grant.expiresAt) })}
                </>
              ) : null}
            </span>
            <button
              type="button"
              className="ml-auto rounded-full p-1 text-muted-foreground hover:bg-surface-3 hover:text-foreground"
              aria-label={t("Stop allowing {rule} for {scope}", {
                rule: ruleProgram(grant.rule),
                scope: grantScope(grant, t),
              })}
              disabled={revoke.isPending}
              onClick={() => revoke.mutate(grant.id)}
            >
              <X className="size-3" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function AllowedCommands({
  projectId,
  initial,
  grants,
}: {
  projectId: string;
  initial: string[];
  grants: CommandGrantDto[];
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const [rules, setRules] = useState(initial);
  const [draft, setDraft] = useState("");
  const stack = useQuery({
    queryKey: queryKeys.projectStack(projectId),
    queryFn: () => api.get<ProjectStackDto>(`/api/projects/${projectId}/stack`),
  });
  const save = useMutation({
    mutationFn: (next: string[]) =>
      api.put<AllowedToolsResponse>(`/api/projects/${projectId}/allowed-tools`, {
        allowedTools: next,
      }),
    onSuccess: (response) => {
      setRules(response.allowedTools);
      void queryClient.invalidateQueries({ queryKey: queryKeys.projectStack(projectId) });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const rule = ruleFor(draft);
    if (rule === null) {
      toast.error(t("Write the start of a command, for example npm install"));
      return;
    }
    if (!rules.includes(rule)) save.mutate([...rules, rule]);
    setDraft("");
  }

  return (
    <Card id="allowed-commands" data-testid="allowed-commands">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Terminal className="size-4 text-primary" />
          {t("Commands agents may run")}
        </CardTitle>
        <CardDescription>
          {t(
            "Besides git status, diff and log and the test and lint scripts, agents in this project may run any command that starts with one of these. Destructive commands (rm -rf, sudo, git push) stay blocked.",
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {rules.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {t("None yet. When a run is refused a command, the run page offers to allow it.")}
          </p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {rules.map((rule) => (
              <li
                key={rule}
                className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-1 py-0.5 pr-1 pl-2.5 font-mono text-xs"
              >
                {ruleProgram(rule)}
                <button
                  type="button"
                  className="rounded-full p-0.5 text-muted-foreground hover:bg-surface-3 hover:text-foreground"
                  aria-label={t("Stop allowing {rule}", { rule: ruleProgram(rule) })}
                  disabled={save.isPending}
                  onClick={() => save.mutate(rules.filter((entry) => entry !== rule))}
                >
                  <X className="size-3" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <Grants projectId={projectId} initial={grants} />
        {stack.data ? (
          <StackSuggestions
            key={stack.data.commands
              .map((command) => `${command.rule}:${command.allowed}`)
              .join("|")}
            stack={stack.data}
            pending={save.isPending}
            onAllow={(chosen) => save.mutate([...new Set([...rules, ...chosen])])}
          />
        ) : null}
        <form className="flex gap-2" onSubmit={add}>
          <Input
            aria-label={t("Command to allow")}
            placeholder={COMMAND_EXAMPLE}
            className="h-8 max-w-xs font-mono text-xs"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
          <Button size="sm" variant="secondary" disabled={save.isPending || !draft.trim()}>
            {save.isPending ? <Loader2 className="animate-spin" /> : <Plus />}
            {t("Allow")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
