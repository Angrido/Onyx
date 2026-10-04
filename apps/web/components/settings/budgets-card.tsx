"use client";

import type {
  BudgetDto,
  BudgetListResponse,
  BudgetPeriod,
  BudgetScope,
  ProjectDto,
} from "@onyx/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "motion/react";
import { Loader2, Pause, Play, Plus, Trash2, Wallet } from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/form-controls";
import { api, errorMessage } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/keys";
import { formatUsd } from "@/lib/format";
import { useT } from "@/lib/i18n/client";
import { msg } from "@/lib/i18n/core";
import { BUDGET_LEVEL_TONES, budgetUsage, periodLabel } from "@/lib/orchestration";
import { cn } from "@/lib/utils";

const LEVEL_LABELS = {
  ok: msg("Within budget"),
  soft: msg("Soft limit passed"),
  hard: msg("Hard limit reached"),
};

function BudgetRow({ budget }: { budget: BudgetDto }) {
  const t = useT();
  const queryClient = useQueryClient();
  const usage = budgetUsage(budget);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: queryKeys.budgets });
  const toggle = useMutation({
    mutationFn: () =>
      api.patch<BudgetDto>(`/api/budgets/${budget.id}`, { enabled: !budget.enabled }),
    onSuccess: refresh,
    onError: (error) => toast.error(errorMessage(error, t)),
  });
  const remove = useMutation({
    mutationFn: () => api.delete(`/api/budgets/${budget.id}`),
    onSuccess: () => {
      refresh();
      toast.success(t("Budget removed"));
    },
    onError: (error) => toast.error(errorMessage(error, t)),
  });
  return (
    <div className={cn("space-y-2 py-3", !budget.enabled && "opacity-60")} data-testid="budget">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">
          {budget.scope === "GLOBAL" ? t("All projects") : (budget.projectName ?? t("Project"))}
        </span>
        <span className="text-xs text-muted-foreground">{periodLabel(budget.period, t)}</span>
        <Badge tone={budget.enabled ? BUDGET_LEVEL_TONES[budget.level] : "neutral"}>
          {budget.enabled ? t(LEVEL_LABELS[budget.level]) : t("Paused")}
        </Badge>
        {budget.level === "soft" && budget.softApproved ? (
          <Badge tone="neutral">{t("approved for {period}", { period: budget.periodKey })}</Badge>
        ) : null}
        <div className="ml-auto flex gap-1">
          <Button
            variant="ghost"
            size="icon"
            aria-label={budget.enabled ? t("Pause the budget") : t("Enable the budget")}
            onClick={() => toggle.mutate()}
            disabled={toggle.isPending}
          >
            {budget.enabled ? <Pause /> : <Play />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t("Remove the budget")}
            onClick={() => remove.mutate()}
            disabled={remove.isPending}
          >
            <Trash2 />
          </Button>
        </div>
      </div>
      <div className="relative h-2 overflow-hidden rounded-full bg-surface-3">
        <motion.div
          className={cn(
            "h-full rounded-full",
            budget.level === "hard"
              ? "bg-destructive"
              : budget.level === "soft"
                ? "bg-warning"
                : "bg-success",
          )}
          initial={false}
          animate={{ width: `${Math.max(2, Math.round(usage.ratio * 100))}%` }}
        />
        {usage.softRatio !== null ? (
          <span
            className="absolute inset-y-0 w-px bg-foreground/50"
            style={{ left: `${usage.softRatio * 100}%` }}
          />
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground">
        {t("{amount} spent in {period}", {
          amount: formatUsd(budget.spentUsd),
          period: budget.periodKey,
        })}
        {budget.softUsd !== null
          ? ` · ${t("soft {amount}", { amount: formatUsd(budget.softUsd) })}`
          : ""}{" "}
        · {t("hard {amount}", { amount: formatUsd(budget.hardUsd) })}
      </p>
    </div>
  );
}

export function BudgetsCard({
  initial,
  projects,
}: {
  initial: BudgetDto[];
  projects: ProjectDto[];
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const { data: budgets = initial } = useQuery({
    queryKey: queryKeys.budgets,
    queryFn: () => api.get<BudgetListResponse>("/api/budgets").then((page) => page.items),
    initialData: initial,
  });
  const [scope, setScope] = useState<BudgetScope>("GLOBAL");
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const [period, setPeriod] = useState<BudgetPeriod>("MONTH");
  const [soft, setSoft] = useState("");
  const [hard, setHard] = useState("");

  const create = useMutation({
    mutationFn: () =>
      api.post<BudgetDto>("/api/budgets", {
        scope,
        projectId: scope === "PROJECT" ? projectId : null,
        period,
        softUsd: soft.trim() ? Number(soft) : null,
        hardUsd: Number(hard),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.budgets });
      setSoft("");
      setHard("");
      toast.success(t("Budget saved"));
    },
    onError: (error) => toast.error(errorMessage(error, t)),
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    create.mutate();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Wallet className="size-4 text-primary" />
          {t("Budgets")}
        </CardTitle>
        <CardDescription>
          {t(
            "Past the soft limit new runs wait until you approve them in Approvals. At the hard limit Onyx refuses new runs and stops the ones in progress. Spend is the cost Claude Code reports for each run plus the planner and roadmap calls.",
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {budgets.length > 0 ? (
          <div className="divide-y divide-border">
            {budgets.map((budget) => (
              <BudgetRow key={budget.id} budget={budget} />
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            {t("No budget yet: spending is not limited.")}
          </p>
        )}
        <form
          className="space-y-3 rounded-lg border border-border bg-surface-1 p-4"
          onSubmit={submit}
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label={t("Applies to")} htmlFor="budget-scope">
              <Select
                id="budget-scope"
                value={scope}
                onChange={(event) =>
                  setScope(event.target.value === "PROJECT" ? "PROJECT" : "GLOBAL")
                }
              >
                <option value="GLOBAL">{t("All projects")}</option>
                <option value="PROJECT" disabled={projects.length === 0}>
                  {t("One project")}
                </option>
              </Select>
            </Field>
            {scope === "PROJECT" ? (
              <Field label={t("Project")} htmlFor="budget-project">
                <Select
                  id="budget-project"
                  value={projectId}
                  onChange={(event) => setProjectId(event.target.value)}
                >
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}
            <Field label={t("Period")} htmlFor="budget-period">
              <Select
                id="budget-period"
                value={period}
                onChange={(event) =>
                  setPeriod(
                    event.target.value === "DAY"
                      ? "DAY"
                      : event.target.value === "LIFETIME"
                        ? "LIFETIME"
                        : "MONTH",
                  )
                }
              >
                <option value="DAY">{t("Per day")}</option>
                <option value="MONTH">{t("Per month")}</option>
                <option value="LIFETIME">{t("In total")}</option>
              </Select>
            </Field>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <Field label={t("Soft limit (USD)")} htmlFor="budget-soft">
              <Input
                id="budget-soft"
                type="number"
                min="0.01"
                step="0.01"
                inputMode="decimal"
                placeholder={t("optional")}
                value={soft}
                onChange={(event) => setSoft(event.target.value)}
              />
            </Field>
            <Field label={t("Hard limit (USD)")} htmlFor="budget-hard">
              <Input
                id="budget-hard"
                type="number"
                min="0.01"
                step="0.01"
                inputMode="decimal"
                required
                value={hard}
                onChange={(event) => setHard(event.target.value)}
              />
            </Field>
            <Button type="submit" disabled={create.isPending || !hard}>
              {create.isPending ? <Loader2 className="animate-spin" /> : <Plus />}
              {t("Add")}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
