"use client";

import type { SavingsOptions, SavingsOptionsDto } from "@onyx/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, PiggyBank, Save } from "lucide-react";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { api, errorMessage } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/keys";

const OPTIONS: { key: keyof SavingsOptions; label: string; hint: string }[] = [
  {
    key: "conciseAnswers",
    label: "Short final summaries",
    hint: "Runs end with at most six lines; the details are in the diff. Applies to new sessions.",
  },
  {
    key: "cheapExploration",
    label: "Explore on a cheaper model",
    hint: "The planner and the roadmap send their searches to an explorer on Haiku, and the roadmap runs on Sonnet. The plan itself stays on the Architect model.",
  },
  {
    key: "batchSmallTasks",
    label: "Group small queued tasks",
    hint: "Up to four short tasks of the same workspace waiting in the queue run as one, each with its own outcome. Tasks the agent does not report go back to the queue.",
  },
];

export function SavingsOptionsCard({ initial }: { initial: SavingsOptionsDto }) {
  const queryClient = useQueryClient();
  const [options, setOptions] = useState<SavingsOptions>({
    conciseAnswers: initial.conciseAnswers,
    cheapExploration: initial.cheapExploration,
    batchSmallTasks: initial.batchSmallTasks,
  });
  const save = useMutation({
    mutationFn: (next: SavingsOptions) =>
      api.put<SavingsOptionsDto>("/api/settings/savings-options", next),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.savings });
      toast.success("Token saving options saved");
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    save.mutate(options);
  }

  return (
    <Card id="savings-options" data-testid="savings-options-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <PiggyBank className="size-4 text-primary" />
          Token saving options
        </CardTitle>
        <CardDescription>
          Each option has its own line in{" "}
          <Link href="/savings" className="text-primary underline underline-offset-2">
            Savings
          </Link>
          , estimated until there is enough data to measure it.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-3" onSubmit={submit}>
          {OPTIONS.map((option) => (
            <label key={option.key} className="flex min-h-6 items-start gap-2.5 text-sm">
              <input
                type="checkbox"
                className="mt-0.5 size-4 shrink-0 accent-[var(--primary)]"
                checked={options[option.key]}
                onChange={(event) => setOptions({ ...options, [option.key]: event.target.checked })}
                data-testid={`option-${option.key}`}
              />
              <span>
                {option.label}
                <span className="block text-xs text-muted-foreground">{option.hint}</span>
              </span>
            </label>
          ))}
          <Button size="sm" variant="secondary" disabled={save.isPending}>
            {save.isPending ? <Loader2 className="animate-spin" /> : <Save />}
            Save
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
