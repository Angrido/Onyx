"use client";

import type { CatalogResponse, OrchestrationDto } from "@onyx/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { GitBranchPlus, Loader2, Network } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { ModelSelect } from "@/components/tasks/model-select";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, Select, Textarea } from "@/components/ui/form-controls";
import { api, errorMessage } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/keys";

export function PlanFeatureDialog({
  projectId,
  catalog,
}: {
  projectId: string;
  catalog: CatalogResponse;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [goal, setGoal] = useState("");
  const [parallelism, setParallelism] = useState(2);
  const [verify, setVerify] = useState(true);
  const [model, setModel] = useState("");

  const create = useMutation({
    mutationFn: () =>
      api.post<OrchestrationDto>(`/api/projects/${projectId}/orchestrations`, {
        goal: goal.trim(),
        parallelism,
        verify,
        ...(model ? { modelId: model } : {}),
      }),
    onSuccess: (plan) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.orchestrations(projectId) });
      setOpen(false);
      setGoal("");
      toast.info("Claude is planning the feature");
      router.push(`/projects/${projectId}/plans/${plan.id}`);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    create.mutate();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary">
          <Network />
          Plan a feature
        </Button>
      </DialogTrigger>
      <DialogContent className="w-[min(94vw,36rem)]">
        <DialogHeader>
          <DialogTitle>Plan a multi-agent feature</DialogTitle>
          <DialogDescription>
            Claude studies the project read-only and splits the feature into tasks per workspace.
            Nothing runs until you approve the plan; then each task gets its own git worktree, the
            independent ones run in parallel and everything is merged into a new work branch.
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={submit}>
          <Field
            label="Feature"
            htmlFor="plan-goal"
            hint="Describe the outcome, the constraints and anything that must not change."
          >
            <Textarea
              id="plan-goal"
              className="min-h-32"
              value={goal}
              onChange={(event) => setGoal(event.target.value)}
              placeholder="Add a cart total on the server and show it, formatted, next to the cart in the UI."
              required
              minLength={10}
            />
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Parallel agents" htmlFor="plan-parallelism">
              <Select
                id="plan-parallelism"
                value={String(parallelism)}
                onChange={(event) => setParallelism(Number(event.target.value))}
              >
                {[1, 2, 3, 4].map((value) => (
                  <option key={value} value={value}>
                    {value === 1 ? "1 at a time" : `Up to ${value}`}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Planner model" htmlFor="plan-model">
              <ModelSelect
                id="plan-model"
                models={catalog.models}
                value={model}
                onChange={setModel}
                defaultLabel="Architect tier"
              />
            </Field>
          </div>
          <label className="flex items-start gap-3 rounded-lg border border-border bg-surface-1 p-3 text-sm">
            <input
              type="checkbox"
              className="mt-0.5 size-4 accent-[var(--primary)]"
              checked={verify}
              onChange={(event) => setVerify(event.target.checked)}
            />
            <span>
              <span className="font-medium">Verify with the tests</span>
              <span className="block text-xs text-muted-foreground">
                Each task runs the TDD loop in its worktree before merging, and the merged branch
                runs the whole suite and the type checker at the end.
              </span>
            </span>
          </label>
          <DialogFooter>
            <Button type="submit" disabled={create.isPending || goal.trim().length < 10}>
              {create.isPending ? <Loader2 className="animate-spin" /> : <GitBranchPlus />}
              Plan it
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
