"use client";

import type { AllowedToolsResponse } from "@onyx/contracts";
import { useMutation } from "@tanstack/react-query";
import { Loader2, Plus, Terminal, X } from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/form-controls";
import { api, errorMessage } from "@/lib/api/client";
import { ruleFor, ruleProgram } from "@/lib/permissions";

export function AllowedCommands({ projectId, initial }: { projectId: string; initial: string[] }) {
  const [rules, setRules] = useState(initial);
  const [draft, setDraft] = useState("");
  const save = useMutation({
    mutationFn: (next: string[]) =>
      api.put<AllowedToolsResponse>(`/api/projects/${projectId}/allowed-tools`, {
        allowedTools: next,
      }),
    onSuccess: (response) => setRules(response.allowedTools),
    onError: (error) => toast.error(errorMessage(error)),
  });

  function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const rule = ruleFor(draft);
    if (rule === null) {
      toast.error("Write the start of a command, for example npm install");
      return;
    }
    if (!rules.includes(rule)) save.mutate([...rules, rule]);
    setDraft("");
  }

  return (
    <Card data-testid="allowed-commands">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Terminal className="size-4 text-primary" />
          Commands agents may run
        </CardTitle>
        <CardDescription>
          Besides git status, diff and log and the test and lint scripts, agents in this project may
          run any command that starts with one of these. Destructive commands (rm -rf, sudo, git
          push) stay blocked.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {rules.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            None yet. When a run is refused a command, the run page offers to allow it.
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
                  aria-label={`Stop allowing ${ruleProgram(rule)}`}
                  disabled={save.isPending}
                  onClick={() => save.mutate(rules.filter((entry) => entry !== rule))}
                >
                  <X className="size-3" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <form className="flex gap-2" onSubmit={add}>
          <Input
            aria-label="Command to allow"
            placeholder="npm install"
            className="h-8 max-w-xs font-mono text-xs"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
          <Button size="sm" variant="secondary" disabled={save.isPending || !draft.trim()}>
            {save.isPending ? <Loader2 className="animate-spin" /> : <Plus />}
            Allow
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
