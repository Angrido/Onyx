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
  Loader2,
  Play,
  RotateCcw,
  Sparkles,
  Square,
  Upload,
  Trash2,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useCallback } from "react";
import { toast } from "sonner";
import { ModelBadge, TierBadge } from "@/components/tasks/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { RelativeTime } from "@/components/ui/relative-time";
import { api, errorMessage } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/keys";
import { formatUsd } from "@/lib/format";
import {
  canResume,
  isNodeBusy,
  isPlanActive,
  isPlanOpen,
  NODE_STATE_LABELS,
  NODE_STATE_TONES,
  PLAN_STATUS_LABELS,
  PLAN_STATUS_TONES,
  planLevels,
  planProgress,
} from "@/lib/orchestration";
import { cn } from "@/lib/utils";
import { useChannel } from "@/lib/ws/context";

const STATE_ICONS = {
  pending: CircleDashed,
  running: Loader2,
  verifying: FlaskConical,
  merging: GitMerge,
  merged: CircleCheck,
  conflict: AlertTriangle,
  failed: CircleX,
  blocked: Ban,
  cancelled: Ban,
} as const;

function NodeCard({ node, byKey }: { node: OrchestrationNode; byKey: Map<string, string> }) {
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
        node.state === "conflict" && "border-warning/60",
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
          {NODE_STATE_LABELS[node.state]}
        </Badge>
      </div>
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
          After {node.dependsOn.map((key) => byKey.get(key) ?? key).join(", ")}
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
            node.state === "conflict"
              ? "border-warning/40 bg-warning/10 text-warning"
              : node.state === "failed"
                ? "border-destructive/40 bg-destructive/10 text-destructive"
                : "border-border bg-surface-2 text-muted-foreground",
          )}
        >
          {node.message}
        </p>
      ) : null}
      <div className="flex items-center justify-between gap-2 border-t border-border pt-2 text-[11px] text-muted-foreground">
        <span className="truncate font-mono">
          {node.mergeCommit ? (
            <>merged {node.mergeCommit.slice(0, 7)}</>
          ) : node.branch ? (
            node.branch.split("--").at(-1)
          ) : (
            "not started"
          )}
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {node.runs > 0 ? `${node.runs} run${node.runs === 1 ? "" : "s"} · ` : ""}
          {formatUsd(node.costUsd)}
          <Link
            href={`/tasks/${node.taskId}`}
            className="inline-flex items-center gap-0.5 text-foreground hover:text-primary"
          >
            Open
            <ArrowRight className="size-3" />
          </Link>
        </span>
      </div>
    </motion.div>
  );
}

function PlanningActivity({ plan }: { plan: OrchestrationDto }) {
  return (
    <Card className="overflow-hidden">
      <CardContent className="flex items-center gap-4 p-5">
        <div className="relative grid size-12 shrink-0 place-items-center rounded-full border border-architect/40 bg-architect/10">
          <Sparkles className="size-5 text-architect" />
          <span className="absolute inset-0 animate-ping rounded-full border border-architect/30" />
        </div>
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-medium">Claude is planning the feature</p>
          <p className="truncate text-xs text-muted-foreground" data-testid="plan-activity">
            {plan.activity?.lastAction ?? "Starting"}
            {plan.activity
              ? ` · ${plan.activity.toolCalls} tool call${plan.activity.toolCalls === 1 ? "" : "s"}`
              : ""}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

export function PlanView({ initial }: { initial: OrchestrationDto }) {
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
        approve: "Plan approved: the agents are starting",
        reject: "Plan discarded",
        cancel: "Plan cancelled",
        resume: "Plan resumed",
      } as const;
      toast.success(labels[action]);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const push = useMutation({
    mutationFn: () => api.post<PublishPlanResult>(`/api/orchestrations/${plan.id}/publish`),
    onSuccess: (result) => {
      if (result.pushed) toast.success(`Pushed ${result.branch}`);
      else toast.error(result.pushError ?? "The push failed");
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const levels = planLevels(plan.nodes);
  const byKey = new Map(plan.nodes.map((node) => [node.key, node.title]));
  const progress = planProgress(plan.nodes);
  const waitingMerge = plan.nodes.some((node) => node.state === "conflict");

  return (
    <div className="space-y-6" data-testid="plan-view" data-status={plan.status}>
      <Card>
        <CardContent className="space-y-4 p-5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={PLAN_STATUS_TONES[plan.status]} data-testid="plan-status">
              {isPlanActive(plan) ? <Loader2 className="size-3 animate-spin" /> : null}
              {PLAN_STATUS_LABELS[plan.status]}
            </Badge>
            {plan.plannerModelId ? <ModelBadge modelId={plan.plannerModelId} /> : null}
            <span className="text-xs text-muted-foreground">
              {plan.parallelism === 1 ? "one agent at a time" : `up to ${plan.parallelism} agents`}
              {plan.verify ? " · verified with the tests" : " · no test verification"}
            </span>
            <span className="ml-auto text-xs text-muted-foreground">
              {formatUsd(plan.costUsd)} · <RelativeTime iso={plan.createdAt} />
            </span>
          </div>
          {plan.summary ? <p className="text-sm leading-relaxed">{plan.summary}</p> : null}
          {plan.workBranch ? (
            <div className="flex flex-wrap items-center gap-2 font-mono text-xs text-muted-foreground">
              <GitBranch className="size-3.5" />
              <span>{plan.baseBranch ?? "HEAD"}</span>
              <span className="text-muted-foreground/60">{plan.baseCommit?.slice(0, 7)}</span>
              <ArrowRight className="size-3" />
              <span className="text-foreground" data-testid="plan-branch">
                {plan.workBranch}
              </span>
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
                {progress.merged} of {progress.total} tasks merged
              </p>
            </div>
          ) : null}
          {plan.message ? (
            <p
              className={cn(
                "rounded-lg border px-3 py-2 text-sm",
                plan.status === "COMPLETED"
                  ? "border-success/40 bg-success/10 text-success"
                  : plan.status === "FAILED"
                    ? "border-destructive/40 bg-destructive/10 text-destructive"
                    : "border-warning/40 bg-warning/10 text-warning",
              )}
              data-testid="plan-message"
            >
              {plan.message}
              {waitingMerge ? (
                <Link href="/approvals" className="ml-2 underline underline-offset-2">
                  Open Approvals
                </Link>
              ) : null}
            </p>
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
          <div className="flex flex-wrap gap-2">
            {plan.status === "AWAITING_APPROVAL" ? (
              <>
                <Button onClick={() => act.mutate("approve")} disabled={act.isPending}>
                  {act.isPending && act.variables === "approve" ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <Play />
                  )}
                  Approve and run
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => act.mutate("reject")}
                  disabled={act.isPending}
                >
                  <Trash2 />
                  Discard the plan
                </Button>
              </>
            ) : null}
            {canResume(plan) ? (
              <Button onClick={() => act.mutate("resume")} disabled={act.isPending}>
                <RotateCcw />
                Resume
              </Button>
            ) : null}
            {isPlanOpen(plan) && plan.status !== "AWAITING_APPROVAL" ? (
              <Button
                variant="secondary"
                onClick={() => act.mutate("cancel")}
                disabled={act.isPending}
              >
                <Square />
                Cancel
              </Button>
            ) : null}
            {plan.status === "COMPLETED" && plan.workBranch ? (
              <Button variant="secondary" onClick={() => push.mutate()} disabled={push.isPending}>
                {push.isPending ? <Loader2 className="animate-spin" /> : <Upload />}
                Push the branch
              </Button>
            ) : null}
            {push.data?.pushed && push.data.compareUrl ? (
              <Button asChild variant="ghost">
                <a href={push.data.compareUrl} target="_blank" rel="noreferrer">
                  <ExternalLink />
                  Open a pull request
                </a>
              </Button>
            ) : null}
            {plan.verifyLoopId ? (
              <Button asChild variant="ghost">
                <Link href={`/tasks/${plan.rootTaskId}`}>
                  <FlaskConical />
                  Final tests
                </Link>
              </Button>
            ) : null}
          </div>
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
                    {index === 0 ? "Starts right away" : `After step ${index}`}
                  </h2>
                  <span className="text-xs text-muted-foreground">
                    {level.length > 1 ? `${level.length} tasks in parallel` : "1 task"}
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
