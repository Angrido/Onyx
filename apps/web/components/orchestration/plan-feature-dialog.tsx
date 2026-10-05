"use client";

import type { CatalogResponse, OrchestrationDto } from "@onyx/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { GitBranchPlus, Loader2, Network } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { AdvancedOptions } from "@/components/tasks/advanced-options";
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
import { HelpTip } from "@/components/ui/help-tip";
import { api, errorMessage } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/keys";
import type { GlossaryId } from "@/lib/glossary";
import { useT } from "@/lib/i18n/client";

function PlanOption({
  id,
  checked,
  onChange,
  label,
  description,
  term,
}: {
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description: string;
  term: GlossaryId;
}) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-border bg-surface-1 p-3 text-sm">
      <input
        id={id}
        type="checkbox"
        className="mt-0.5 size-4 shrink-0 accent-[var(--primary)]"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        data-testid={id}
      />
      <div className="min-w-0">
        <div className="flex items-center gap-0.5">
          <label htmlFor={id} className="font-medium">
            {label}
          </label>
          <HelpTip term={term} />
        </div>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

export function PlanFeatureDialog({
  projectId,
  catalog,
}: {
  projectId: string;
  catalog: CatalogResponse;
}) {
  const t = useT();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [goal, setGoal] = useState("");
  const [parallelism, setParallelism] = useState(2);
  const [verify, setVerify] = useState(true);
  const [qa, setQa] = useState(true);
  const [resolveConflicts, setResolveConflicts] = useState(true);
  const [model, setModel] = useState("");

  const create = useMutation({
    mutationFn: () =>
      api.post<OrchestrationDto>(`/api/projects/${projectId}/orchestrations`, {
        goal: goal.trim(),
        parallelism,
        verify,
        qa,
        resolveConflicts,
        ...(model ? { modelId: model } : {}),
      }),
    onSuccess: (plan) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.orchestrations(projectId) });
      setOpen(false);
      setGoal("");
      toast.info(t("Claude is planning the feature"));
      router.push(`/projects/${projectId}/plans/${plan.id}`);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    create.mutate();
  }

  const customized = parallelism !== 2 || !verify || !qa || !resolveConflicts || model !== "";

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary">
          <Network />
          {t("Plan a feature")}
        </Button>
      </DialogTrigger>
      <DialogContent className="w-[min(94vw,36rem)]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-0.5">
            {t("Plan a multi-agent feature")}
            <HelpTip term="plan" />
          </DialogTitle>
          <DialogDescription>
            {t(
              "Claude studies the project read-only and splits the feature into tasks per workspace. Nothing runs until you approve the plan; then each task gets its own git worktree, the independent ones run in parallel and everything is merged into a new work branch.",
            )}
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={submit}>
          <Field
            label={t("Feature")}
            htmlFor="plan-goal"
            hint={t("Describe the outcome, the constraints and anything that must not change.")}
          >
            <Textarea
              id="plan-goal"
              className="min-h-32"
              value={goal}
              onChange={(event) => setGoal(event.target.value)}
              placeholder={t(
                "Add a cart total on the server and show it, formatted, next to the cart in the UI.",
              )}
              required
              minLength={10}
            />
          </Field>
          <AdvancedOptions
            title={t("Advanced options")}
            summary={t("Parallel agents, planner model, tests, QA, conflicts")}
            defaultOpen={customized}
            variant="inline"
            testId="plan-create-advanced"
          >
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label={t("Parallel agents")} htmlFor="plan-parallelism">
                <Select
                  id="plan-parallelism"
                  value={String(parallelism)}
                  onChange={(event) => setParallelism(Number(event.target.value))}
                >
                  {[1, 2, 3, 4].map((value) => (
                    <option key={value} value={value}>
                      {value === 1 ? t("1 at a time") : t("Up to {count}", { count: value })}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t("Planner model")} htmlFor="plan-model">
                <ModelSelect
                  id="plan-model"
                  models={catalog.models}
                  value={model}
                  onChange={setModel}
                  defaultLabel={t("Architect tier")}
                />
              </Field>
            </div>
            <PlanOption
              id="plan-verify"
              checked={verify}
              onChange={setVerify}
              term="tdd"
              label={t("Verify with the tests")}
              description={t(
                "Each task runs the TDD loop in its worktree before merging, and the merged branch runs the whole suite and the type checker at the end.",
              )}
            />
            <PlanOption
              id="plan-qa"
              checked={qa}
              onChange={setQa}
              term="qa"
              label={t("Review each task before merging (QA)")}
              description={t(
                "A read-only reviewer on the Builder model checks the diff against the acceptance criteria, about 5–20K tokens per task. Problems go back to the agent once; if they remain, Approvals asks you.",
              )}
            />
            <PlanOption
              id="plan-resolve"
              checked={resolveConflicts}
              onChange={setResolveConflicts}
              term="worktree"
              label={t("Let Claude propose conflict resolutions")}
              description={t(
                "Only when a merge conflicts: Claude edits the conflicted files, the tests run on the result, and nothing is applied until you approve the diff.",
              )}
            />
          </AdvancedOptions>
          <DialogFooter>
            <Button type="submit" disabled={create.isPending || goal.trim().length < 10}>
              {create.isPending ? <Loader2 className="animate-spin" /> : <GitBranchPlus />}
              {t("Plan it")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
