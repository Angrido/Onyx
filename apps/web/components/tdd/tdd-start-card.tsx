"use client";

import type { TaskDetailDto, TddDefaultsDto, TddLoopDto, TestRunner } from "@onyx/contracts";
import { TEST_RUNNERS, oneOf } from "@onyx/contracts/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FlaskConical, Loader2, Play, ShieldCheck } from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/form-controls";
import { api, errorMessage } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/keys";
import { useT } from "@/lib/i18n/client";
import { runnerLabel, upsertLoop } from "@/lib/tdd";

export function TddStartCard({ task, disabled }: { task: TaskDetailDto; disabled: boolean }) {
  const t = useT();
  const queryClient = useQueryClient();
  const defaults = useQuery({
    queryKey: queryKeys.tddDefaults(task.id),
    queryFn: () => api.get<TddDefaultsDto>(`/api/tasks/${task.id}/tdd/defaults`),
    staleTime: 30_000,
  });
  const [runner, setRunner] = useState<TestRunner | "">("");
  const [attempts, setAttempts] = useState("6");
  const [budget, setBudget] = useState("");
  const [typecheckDraft, setTypecheckDraft] = useState<boolean | null>(null);
  const [lint, setLint] = useState(false);
  const typecheckAvailable = Boolean(defaults.data?.typecheckCommand);
  const typecheck = typecheckDraft ?? typecheckAvailable;
  const effectiveRunner = runner === "" ? (defaults.data?.runner ?? null) : runner;

  const start = useMutation({
    mutationFn: () =>
      api.post<TddLoopDto>(`/api/tasks/${task.id}/tdd`, {
        ...(runner === "" ? {} : { runner }),
        maxIterations: Number.parseInt(attempts, 10),
        budgetUsd: budget.trim().length > 0 ? Number.parseFloat(budget) : null,
        typecheck,
        lint,
      }),
    onSuccess: (loop) => {
      queryClient.setQueryData<TddLoopDto[]>(queryKeys.tddLoops(task.id), (current) =>
        upsertLoop(current ?? [], loop),
      );
      void queryClient.invalidateQueries({ queryKey: queryKeys.task(task.id) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.tddDefaults(task.id) });
      toast.success(t("TDD loop started"));
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    start.mutate();
  }

  return (
    <Card data-testid="tdd-start">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FlaskConical className="size-4 text-primary" />
          {t("TDD loop")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form className="space-y-3" onSubmit={submit}>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {t(
              "Onyx runs the tests, gives the agent a short digest of what fails and repeats until everything is green. The tests stay read-only.",
            )}
          </p>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("Runner")} htmlFor="tdd-runner">
              <Select
                id="tdd-runner"
                value={runner}
                onChange={(event) =>
                  setRunner(
                    event.target.value === ""
                      ? ""
                      : (oneOf(TEST_RUNNERS, event.target.value) ?? ""),
                  )
                }
              >
                <option value="">
                  {t("Auto · {runner}", { runner: runnerLabel(defaults.data?.runner ?? null, t) })}
                </option>
                <option value="VITEST">{runnerLabel("VITEST")}</option>
                <option value="JEST">{runnerLabel("JEST")}</option>
              </Select>
            </Field>
            <Field label={t("Fix attempts")} htmlFor="tdd-attempts">
              <Input
                id="tdd-attempts"
                type="number"
                min={1}
                max={20}
                value={attempts}
                onChange={(event) => setAttempts(event.target.value)}
              />
            </Field>
          </div>
          <Field label={t("Budget (USD)")} htmlFor="tdd-budget" hint={t("Empty: no limit.")}>
            <Input
              id="tdd-budget"
              type="number"
              min={0.01}
              step={0.01}
              placeholder="2.00"
              value={budget}
              onChange={(event) => setBudget(event.target.value)}
            />
          </Field>
          <div className="space-y-2 text-xs">
            <label className="flex min-h-6 items-center gap-2.5 text-muted-foreground">
              <input
                type="checkbox"
                className="size-4 accent-[var(--primary)]"
                checked={typecheck}
                disabled={!typecheckAvailable}
                onChange={(event) => setTypecheckDraft(event.target.checked)}
              />
              {t("Type check")} (tsc --noEmit)
              {!typecheckAvailable ? (
                <span className="text-[11px]">· {t("no tsconfig.json")}</span>
              ) : null}
            </label>
            <label className="flex min-h-6 items-center gap-2.5 text-muted-foreground">
              <input
                type="checkbox"
                className="size-4 accent-[var(--primary)]"
                checked={lint}
                onChange={(event) => setLint(event.target.checked)}
              />
              {t("Lint")}
              {defaults.data ? (
                <span className="truncate font-mono text-[11px]">{defaults.data.lintCommand}</span>
              ) : null}
            </label>
          </div>
          {defaults.data ? (
            <div className="space-y-1.5 rounded-lg border border-border bg-surface-0/60 p-2.5 text-[11px] text-muted-foreground">
              <p className="flex items-center gap-1.5">
                <ShieldCheck className="size-3.5 text-success" />
                {defaults.data.protectedFiles === 1
                  ? t("1 test file protected")
                  : t("{count} test files protected", { count: defaults.data.protectedFiles })}
              </p>
              {defaults.data.relatedFiles.length > 0 ? (
                <p className="truncate" title={defaults.data.relatedFiles.join(", ")}>
                  {t("First runs the tests related to")}{" "}
                  <span className="font-mono">{defaults.data.relatedFiles.join(", ")}</span>
                </p>
              ) : (
                <p>{t("Runs the whole suite every time (no target files).")}</p>
              )}
            </div>
          ) : null}
          <Button
            type="submit"
            className="w-full"
            disabled={disabled || start.isPending || effectiveRunner === null}
          >
            {start.isPending ? <Loader2 className="animate-spin" /> : <Play />}
            {t("Start TDD loop")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
