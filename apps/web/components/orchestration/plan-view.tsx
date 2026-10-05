"use client";

import type {
  OrchestrationDto,
  OrchestrationNode,
  PublishPlanResult,
  ServerMessage,
} from "@onyx/contracts";
import { channels } from "@onyx/contracts/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowRight,
  Ban,
  Check,
  CircleCheck,
  CircleDashed,
  CircleX,
  ExternalLink,
  FlaskConical,
  GitBranch,
  GitMerge,
  Inbox,
  Loader2,
  Play,
  RotateCcw,
  SearchCheck,
  Sparkles,
  Square,
  Upload,
  Trash2,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useCallback } from "react";
import { toast } from "sonner";
import { NodeResolution, NodeReview } from "@/components/orchestration/node-review";
import { StatusBanner } from "@/components/tasks/status-banner";
import { ModelBadge, TierBadge } from "@/components/tasks/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { HelpTip } from "@/components/ui/help-tip";
import { RelativeTime } from "@/components/ui/relative-time";
import { api, errorMessage } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/keys";
import { formatUsd } from "@/lib/format";
import { useT } from "@/lib/i18n/client";
import {
  isNodeBusy,
  isPlanActive,
  NODE_STATE_LABELS,
  NODE_STATE_TONES,
  PLAN_STATUS_LABELS,
  PLAN_STATUS_TONES,
  planLevels,
  planProgress,
} from "@/lib/orchestration";
import { NODE_STATE_HINTS, planBanner } from "@/lib/plan-guide";
import { cn } from "@/lib/utils";
import { useChannel } from "@/lib/ws/context";

const STATE_ICONS = {
  pending: CircleDashed,
  running: Loader2,
  verifying: FlaskConical,
  reviewing: SearchCheck,
  review: AlertTriangle,
  merging: GitMerge,
  merged: CircleCheck,
  conflict: AlertTriangle,
  failed: CircleX,
  blocked: Ban,
  cancelled: Ban,
} as const;

function NodeCard({ node, byKey }: { node: OrchestrationNode; byKey: Map<string, string> }) {
  const t = useT();
  const Icon = STATE_ICONS[node.state];
  const busy = isNodeBusy(node);
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      data-testid="plan-node"
      data-key={node.key}
      data-state={node.state}
      className={cn(
        "relative space-y-3 rounded-xl border bg-surface-1 p-4 transition-colors",
        busy ? "border-primary/50 shadow-[0_0_32px_-12px_var(--primary)]" : "border-border",
        (node.state === "conflict" || node.state === "review") && "border-warning/60",
        node.state === "failed" && "border-destructive/50",
        node.state === "merged" && "border-success/40",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-semibold leading-snug">{node.title}</p>
          <p className="font-mono text-[11px] text-muted-foreground">{node.key}</p>
        </div>
        <Badge tone={NODE_STATE_TONES[node.state]} className="shrink-0">
          <Icon className={cn("size-3", node.state === "running" && "animate-spin")} />
          {t(NODE_STATE_LABELS[node.state])}
        </Badge>
      </div>
      <p className="text-xs font-medium" data-testid="plan-node-hint">
        {t(NODE_STATE_HINTS[node.state])}
      </p>
      <p className="line-clamp-4 text-xs leading-relaxed text-muted-foreground">
        {node.description}
      </p>
      <div className="flex flex-wrap items-center gap-1.5">
        {node.workspaceName ? <Badge>{node.workspaceName}</Badge> : null}
        {node.tier ? <TierBadge tier={node.tier} /> : null}
        {node.lastModelId ? <ModelBadge modelId={node.lastModelId} /> : null}
      </div>
      {node.dependsOn.length > 0 ? (
        <p className="text-[11px] text-muted-foreground">
          {t("After {tasks}", {
            tasks: node.dependsOn.map((key) => byKey.get(key) ?? key).join(", "),
          })}
        </p>
      ) : null}
      {node.targetPaths.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {node.targetPaths.slice(0, 4).map((path) => (
            <span
              key={path}
              className="rounded border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
            >
              {path}
            </span>
          ))}
          {node.targetPaths.length > 4 ? (
            <span className="text-[10px] text-muted-foreground">
              +{node.targetPaths.length - 4}
            </span>
          ) : null}
        </div>
      ) : null}
      {node.acceptance.length > 0 ? (
        <ul className="space-y-0.5 text-[11px] text-muted-foreground">
          {node.acceptance.slice(0, 3).map((check) => (
            <li key={check} className="flex gap-1.5">
              <Check className="mt-0.5 size-3 shrink-0 text-success/80" />
              <span>{check}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {node.message && node.state !== "merged" ? (
        <p
          className={cn(
            "rounded-md border px-2.5 py-1.5 text-[11px]",
            node.state === "conflict" || node.state === "review"
              ? "border-warning/40 bg-warning/10 text-warning"
              : node.state === "failed"
                ? "border-destructive/40 bg-destructive/10 text-destructive"
                : "border-border bg-surface-2 text-muted-foreground",
          )}
        >
          {node.message}
        </p>
      ) : null}
      {node.review ? <NodeReview review={node.review} reviews={node.reviews} /> : null}
      {node.resolution ? <NodeResolution resolution={node.resolution} /> : null}
      <div className="flex items-center justify-between gap-2 border-t border-border pt-2 text-[11px] text-muted-foreground">
        <span className="truncate font-mono">
          {node.mergeCommit
            ? t("merged {commit}", { commit: node.mergeCommit.slice(0, 7) })
            : node.branch
              ? node.branch.split("--").at(-1)
              : t("not started")}
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {node.runs === 1 ? `${t("1 run")} · ` : ""}
          {node.runs > 1 ? `${t("{count} runs", { count: node.runs })} · ` : ""}
          {formatUsd(node.costUsd)}
          <Link
            href={`/tasks/${node.taskId}`}
            className="inline-flex items-center gap-0.5 text-foreground hover:text-primary"
          >
            {t("Open")}
            <ArrowRight className="size-3" />
          </Link>
        </span>
      </div>
    </motion.div>
  );
}

function PlanningActivity({ plan }: { plan: OrchestrationDto }) {
  const t = useT();
  return (
    <Card className="overflow-hidden">
      <CardContent className="flex items-center gap-4 p-5">
        <div className="relative grid size-12 shrink-0 place-items-center rounded-full border border-architect/40 bg-architect/10">
          <Sparkles className="size-5 text-architect" />
          <span className="absolute inset-0 animate-ping rounded-full border border-architect/30" />
        </div>
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-medium">{t("Claude is planning the feature")}</p>
          <p className="truncate text-xs text-muted-foreground" data-testid="plan-activity">
            {plan.activity?.lastAction ?? t("Starting")}
            {plan.activity
              ? ` · ${
                  plan.activity.toolCalls === 1
                    ? t("1 tool call")
                    : t("{count} tool calls", { count: plan.activity.toolCalls })
                }`
              : ""}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

export function PlanView({ initial }: { initial: OrchestrationDto }) {
  const t = useT();
  const queryClient = useQueryClient();
  const key = queryKeys.orchestration(initial.id);
  const { data: plan = initial } = useQuery({
    queryKey: key,
    queryFn: () => api.get<OrchestrationDto>(`/api/orchestrations/${initial.id}`),
    initialData: initial,
    refetchInterval: (query) =>
      query.state.data && isPlanActive(query.state.data) ? 8_000 : false,
  });

  const onMessage = useCallback(
    (message: ServerMessage) => {
      if (message.type !== "orchestration.state") return;
      queryClient.setQueryData(queryKeys.orchestration(initial.id), message.data.orchestration);
    },
    [queryClient, initial.id],
  );
  useChannel(channels.orchestration(initial.id), onMessage);

  const act = useMutation({
    mutationFn: (action: "approve" | "reject" | "cancel" | "resume") =>
      api.post<OrchestrationDto>(`/api/orchestrations/${plan.id}/${action}`),
    onSuccess: (updated, action) => {
      queryClient.setQueryData(key, updated);
      void queryClient.invalidateQueries({ queryKey: queryKeys.approvals });
      void queryClient.invalidateQueries({ queryKey: queryKeys.orchestrations(plan.projectId) });
      const labels = {
        approve: t("Plan approved: the agents are starting"),
        reject: t("Plan discarded"),
        cancel: t("Plan cancelled"),
        resume: t("Plan resumed"),
      } as const;
      toast.success(labels[action]);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const push = useMutation({
    mutationFn: () => api.post<PublishPlanResult>(`/api/orchestrations/${plan.id}/publish`),
    onSuccess: (result) => {
      if (result.pushed) toast.success(t("Pushed {branch}", { branch: result.branch }));
      else toast.error(result.pushError ?? t("The push failed"));
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const levels = planLevels(plan.nodes);
  const byKey = new Map(plan.nodes.map((node) => [node.key, node.title]));
  const progress = planProgress(plan.nodes);

  const banner = planBanner(plan);

  return (
    <div className="space-y-6" data-testid="plan-view" data-status={plan.status}>
      <StatusBanner
        banner={banner}
        testId="plan-banner"
        extra={
          plan.message && plan.status !== "FAILED" ? (
            <p className="break-words text-xs text-muted-foreground" data-testid="plan-message">
              {plan.message}
            </p>
          ) : null
        }
      >
        {banner.actions.map((action) => {
          switch (action) {
            case "approve":
              return (
                <Button
                  key={action}
                  size="sm"
                  onClick={() => act.mutate("approve")}
                  disabled={act.isPending}
                >
                  {act.isPending && act.variables === "approve" ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <Play />
                  )}
                  {t("Approve and run")}
                </Button>
              );
            case "reject":
              return (
                <Button
                  key={action}
                  size="sm"
                  variant="secondary"
                  onClick={() => act.mutate("reject")}
                  disabled={act.isPending}
                >
                  <Trash2 />
                  {t("Discard the plan")}
                </Button>
              );
            case "resume":
              return (
                <Button
                  key={action}
                  size="sm"
                  onClick={() => act.mutate("resume")}
                  disabled={act.isPending}
                >
                  <RotateCcw />
                  {t("Resume")}
                </Button>
              );
            case "cancel":
              return (
                <Button
                  key={action}
                  size="sm"
                  variant="secondary"
                  onClick={() => act.mutate("cancel")}
                  disabled={act.isPending}
                >
                  <Square />
                  {t("Cancel")}
                </Button>
              );
            case "push":
              return (
                <Button
                  key={action}
                  size="sm"
                  onClick={() => push.mutate()}
                  disabled={push.isPending}
                >
                  {push.isPending ? <Loader2 className="animate-spin" /> : <Upload />}
                  {t("Push the branch")}
                </Button>
              );
            case "approvals":
              return (
                <Button key={action} size="sm" asChild>
                  <Link href="/approvals">
                    <Inbox />
                    {t("Open Approvals")}
                  </Link>
                </Button>
              );
          }
        })}
        {push.data?.pushed && push.data.compareUrl ? (
          <Button asChild size="sm" variant="secondary">
            <a href={push.data.compareUrl} target="_blank" rel="noreferrer">
              <ExternalLink />
              {t("Open a pull request")}
            </a>
          </Button>
        ) : null}
        {plan.verifyLoopId ? (
          <Button asChild size="sm" variant="ghost">
            <Link href={`/tasks/${plan.rootTaskId}`}>
              <FlaskConical />
              {t("Final tests")}
            </Link>
          </Button>
        ) : null}
        {banner.actions.includes("approve") || banner.actions.includes("approvals") ? (
          <HelpTip term="approval" className="self-center" />
        ) : null}
      </StatusBanner>
      <Card>
        <CardContent className="space-y-4 p-5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={PLAN_STATUS_TONES[plan.status]} data-testid="plan-status">
              {isPlanActive(plan) ? <Loader2 className="size-3 animate-spin" /> : null}
              {t(PLAN_STATUS_LABELS[plan.status])}
            </Badge>
            {plan.plannerModelId ? <ModelBadge modelId={plan.plannerModelId} /> : null}
            <span className="text-xs text-muted-foreground">
              {plan.parallelism === 1
                ? t("one agent at a time")
                : t("up to {count} agents", { count: plan.parallelism })}
              {` · ${plan.verify ? t("verified with the tests") : t("no test verification")}`}
              {plan.qa ? ` · ${t("QA before merging")}` : ""}
              {plan.resolveConflicts ? ` · ${t("Claude proposes conflict fixes")}` : ""}
              {plan.qaCostUsd > 0
                ? ` · ${t("{cost} on QA and conflicts", { cost: formatUsd(plan.qaCostUsd) })}`
                : ""}
            </span>
            {plan.qa ? <HelpTip term="qa" /> : null}
            <span className="ml-auto text-xs text-muted-foreground">
              {formatUsd(plan.costUsd)} · <RelativeTime iso={plan.createdAt} />
            </span>
          </div>
          {plan.summary ? <p className="text-sm leading-relaxed">{plan.summary}</p> : null}
          {plan.workBranch ? (
            <div className="flex flex-wrap items-center gap-2 font-mono text-xs text-muted-foreground">
              <GitBranch className="size-3.5" aria-hidden="true" />
              <span>{plan.baseBranch ?? "HEAD"}</span>
              <span>{plan.baseCommit?.slice(0, 7)}</span>
              <ArrowRight className="size-3" aria-hidden="true" />
              <span className="break-all text-foreground" data-testid="plan-branch">
                {plan.workBranch}
              </span>
              <span className="font-sans">{t("work branch")}</span>
              <HelpTip term="worktree" />
            </div>
          ) : null}
          {progress.total > 0 && plan.status !== "AWAITING_APPROVAL" ? (
            <div className="space-y-1.5">
              <div className="h-1.5 overflow-hidden rounded-full bg-surface-3">
                <motion.div
                  className="h-full rounded-full bg-gradient-to-r from-primary to-success"
                  initial={false}
                  animate={{ width: `${Math.round(progress.ratio * 100)}%` }}
                  transition={{ type: "spring", stiffness: 120, damping: 20 }}
                />
              </div>
              <p className="text-[11px] text-muted-foreground">
                {t("{merged} of {total} tasks merged", {
                  merged: progress.merged,
                  total: progress.total,
                })}
              </p>
            </div>
          ) : null}
          {plan.warnings.length > 0 ? (
            <ul className="space-y-1 text-xs text-warning">
              {plan.warnings.map((warning) => (
                <li key={warning} className="flex gap-1.5">
                  <AlertTriangle className="mt-0.5 size-3 shrink-0" />
                  {warning}
                </li>
              ))}
            </ul>
          ) : null}
        </CardContent>
      </Card>

      {plan.status === "PLANNING" ? <PlanningActivity plan={plan} /> : null}

      {levels.length > 0 ? (
        <AnimatePresence initial={false}>
          <div className="space-y-6">
            {levels.map((level, index) => (
              <section key={level[0]?.key ?? index} className="space-y-3">
                <div className="flex items-center gap-3">
                  <span className="grid size-6 place-items-center rounded-full border border-border-strong bg-surface-2 text-[11px] font-semibold">
                    {index + 1}
                  </span>
                  <h2 className="text-sm font-semibold tracking-tight">
                    {index === 0 ? t("Starts right away") : t("After step {step}", { step: index })}
                  </h2>
                  <span className="text-xs text-muted-foreground">
                    {level.length > 1
                      ? t("{count} tasks in parallel", { count: level.length })
                      : t("1 task")}
                  </span>
                </div>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {level.map((node) => (
                    <NodeCard key={node.taskId} node={node} byKey={byKey} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        </AnimatePresence>
      ) : null}
    </div>
  );
}
