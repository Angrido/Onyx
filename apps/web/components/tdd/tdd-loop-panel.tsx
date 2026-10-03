"use client";

import type { ServerMessage, TddIterationDto, TddLoopDto } from "@onyx/contracts";
import { channels } from "@onyx/contracts/client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ChevronsUp,
  CircleCheck,
  CircleX,
  FlaskConical,
  Loader2,
  ShieldAlert,
  Square,
  Undo2,
} from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { ModelBadge } from "@/components/tasks/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select } from "@/components/ui/form-controls";
import { RelativeTime } from "@/components/ui/relative-time";
import { TerminalView } from "@/components/workspaces/terminal-view";
import { api, errorMessage } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/keys";
import { formatDuration, formatUsd } from "@/lib/format";
import {
  attemptsLabel,
  isLoopActive,
  iterationOutcome,
  runnerLabel,
  TDD_PHASE_LABELS,
  TDD_SCOPE_LABELS,
  TDD_STATUS_LABELS,
  TDD_STATUS_TONES,
  upsertLoop,
} from "@/lib/tdd";
import { useChannel } from "@/lib/ws/context";
import { cn } from "@/lib/utils";

const OUTCOME_STYLES = {
  green: { icon: CircleCheck, className: "border-success/40 bg-success/10 text-success" },
  red: { icon: CircleX, className: "border-destructive/40 bg-destructive/10 text-destructive" },
  reverted: { icon: Undo2, className: "border-warning/40 bg-warning/10 text-warning" },
} as const;

function IterationChip({
  iteration,
  selected,
  onSelect,
}: {
  iteration: TddIterationDto;
  selected: boolean;
  onSelect: () => void;
}) {
  const outcome = iterationOutcome(iteration);
  const style = OUTCOME_STYLES[outcome];
  const Icon = style.icon;
  return (
    <motion.button
      type="button"
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      onClick={onSelect}
      data-testid="tdd-iteration"
      data-outcome={outcome}
      className={cn(
        "flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-shadow",
        style.className,
        selected && "ring-2 ring-primary/60",
      )}
    >
      <Icon className="size-3.5" />
      <span>{TDD_SCOPE_LABELS[iteration.scope]}</span>
      {outcome === "red" ? <span className="tabular">{iteration.failed}</span> : null}
      {iteration.escalated ? <ChevronsUp className="size-3.5" /> : null}
    </motion.button>
  );
}

function IterationDetail({ iteration }: { iteration: TddIterationDto }) {
  return (
    <div className="space-y-2 rounded-lg border border-border bg-surface-0/60 p-3 text-xs">
      <div className="flex flex-wrap items-center gap-2 text-muted-foreground">
        <span className="font-medium text-foreground">
          #{iteration.index + 1} · {TDD_SCOPE_LABELS[iteration.scope]}
        </span>
        {iteration.scope !== "guard" ? (
          <span className="tabular">
            {iteration.passed} passed · {iteration.failed} failing · {iteration.skipped} skipped ·{" "}
            {formatDuration(iteration.durationMs)}
          </span>
        ) : null}
        {iteration.regressions > 0 ? (
          <Badge tone="danger">{iteration.regressions} regressions</Badge>
        ) : null}
        {iteration.timedOut ? <Badge tone="warning">timed out</Badge> : null}
        {iteration.escalated ? <Badge tone="architect">escalated after this</Badge> : null}
        {iteration.agentModelId ? <ModelBadge modelId={iteration.agentModelId} /> : null}
        {iteration.agentCostUsd !== null ? (
          <span className="tabular">{formatUsd(iteration.agentCostUsd)}</span>
        ) : null}
      </div>
      {iteration.revertedFiles.length > 0 ? (
        <p className="flex items-start gap-1.5 text-warning">
          <ShieldAlert className="mt-0.5 size-3.5 shrink-0" />
          The agent changed {iteration.revertedFiles.join(", ")}: Onyx restored the tests and asked
          for an implementation fix.
        </p>
      ) : null}
      {iteration.digest ? (
        <details open={iteration.scope !== "guard"}>
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
            {iteration.agentRunId ? "Digest sent to the agent" : "Failure digest"}
            {iteration.digestTokens !== null ? ` · ${iteration.digestTokens} tokens` : ""}
          </summary>
          <pre
            className="scrollbar-thin mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-md bg-[#0c0c11] p-3 font-mono text-[11px] leading-relaxed text-foreground/90"
            data-testid="tdd-digest"
          >
            {iteration.digest}
          </pre>
        </details>
      ) : (
        <p className="text-success">Everything passed.</p>
      )}
    </div>
  );
}

function LoopSignal({ loop }: { loop: TddLoopDto }) {
  const reduced = useReducedMotion() ?? false;
  const last = loop.iterations.at(-1) ?? null;
  if (reduced) return null;
  if (loop.status === "GREEN")
    return (
      <motion.span
        key={`green-${loop.id}`}
        aria-hidden
        data-testid="tdd-green-wave"
        className="pointer-events-none absolute left-10 top-8 size-24 rounded-full bg-success/30"
        initial={{ scale: 0, opacity: 0.6 }}
        animate={{ scale: 9, opacity: 0 }}
        transition={{ duration: 1.4, ease: "easeOut" }}
      />
    );
  if (last && isLoopActive(loop) && iterationOutcome(last) === "red")
    return (
      <motion.span
        key={`red-${last.id}`}
        aria-hidden
        data-testid="tdd-red-flash"
        className="pointer-events-none absolute inset-0 rounded-xl bg-destructive/15 ring-1 ring-inset ring-destructive/50"
        initial={{ opacity: 1 }}
        animate={{ opacity: 0 }}
        transition={{ duration: 0.9, ease: "easeOut" }}
      />
    );
  return null;
}

export function TddLoopPanel({ taskId, loops }: { taskId: string; loops: TddLoopDto[] }) {
  const queryClient = useQueryClient();
  const [pinnedLoop, setPinnedLoop] = useState<string | null>(null);
  const [pinnedIteration, setPinnedIteration] = useState<string | null>(null);
  const loop = loops.find((entry) => entry.id === pinnedLoop) ?? loops[0] ?? null;
  const active = loop ? isLoopActive(loop) : false;
  const iteration =
    loop?.iterations.find((entry) => entry.id === pinnedIteration) ??
    loop?.iterations.at(-1) ??
    null;

  const onMessage = useCallback(
    (message: ServerMessage) => {
      if (message.type !== "tdd.state") return;
      queryClient.setQueryData<TddLoopDto[]>(queryKeys.tddLoops(taskId), (current) =>
        upsertLoop(current ?? [], message.data.loop),
      );
    },
    [queryClient, taskId],
  );
  useChannel(loop ? channels.tdd(loop.id) : null, onMessage, { enabled: active });

  const abort = useMutation({
    mutationFn: (loopId: string) => api.post<TddLoopDto>(`/api/tdd-loops/${loopId}/abort`),
    onSuccess: (updated) => {
      queryClient.setQueryData<TddLoopDto[]>(queryKeys.tddLoops(taskId), (current) =>
        upsertLoop(current ?? [], updated),
      );
      void queryClient.invalidateQueries({ queryKey: queryKeys.task(taskId) });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  if (!loop) return null;

  return (
    <Card data-testid="tdd-panel" className="relative overflow-hidden">
      <LoopSignal loop={loop} />
      <CardContent className="relative space-y-4 pt-5">
        <div className="flex flex-wrap items-center gap-2">
          <FlaskConical className="size-4 text-primary" />
          <span className="text-sm font-semibold">TDD loop</span>
          <Badge tone={TDD_STATUS_TONES[loop.status]} data-testid="tdd-status">
            {TDD_STATUS_LABELS[loop.status]}
          </Badge>
          {loop.phase ? (
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              {TDD_PHASE_LABELS[loop.phase]}
            </span>
          ) : null}
          <div className="ml-auto flex items-center gap-2">
            {loops.length > 1 ? (
              <Select
                aria-label="Loop"
                className="h-8 w-auto text-xs"
                value={loop.id}
                onChange={(event) => {
                  setPinnedLoop(event.target.value);
                  setPinnedIteration(null);
                }}
              >
                {loops.map((entry, index) => (
                  <option key={entry.id} value={entry.id}>
                    {index === 0 ? "Latest" : `Loop ${loops.length - index}`} ·{" "}
                    {TDD_STATUS_LABELS[entry.status]}
                  </option>
                ))}
              </Select>
            ) : null}
            {active ? (
              <Button
                size="sm"
                variant="destructive"
                disabled={abort.isPending}
                onClick={() => abort.mutate(loop.id)}
              >
                {abort.isPending ? <Loader2 className="animate-spin" /> : <Square />}
                Stop
              </Button>
            ) : null}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
          <div className="rounded-lg bg-surface-2/60 px-3 py-2">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Attempts</p>
            <p className="tabular relative h-5 overflow-hidden text-sm font-semibold">
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.span
                  key={loop.iterationCount}
                  className="block"
                  data-testid="tdd-attempts"
                  initial={{ y: "100%", opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  exit={{ y: "-100%", opacity: 0 }}
                  transition={{ type: "spring", stiffness: 380, damping: 30 }}
                >
                  {attemptsLabel(loop)}
                </motion.span>
              </AnimatePresence>
            </p>
          </div>
          <div className="rounded-lg bg-surface-2/60 px-3 py-2">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Cost</p>
            <p className="tabular text-sm font-semibold">
              {formatUsd(loop.costUsd)}
              {loop.budgetUsd !== null ? (
                <span className="font-normal text-muted-foreground">
                  {" "}
                  / {formatUsd(loop.budgetUsd)}
                </span>
              ) : null}
            </p>
          </div>
          <div className="rounded-lg bg-surface-2/60 px-3 py-2">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Protected tests
            </p>
            <p className="tabular text-sm font-semibold">{loop.protectedFiles}</p>
          </div>
          <div
            className={cn(
              "rounded-lg px-3 py-2",
              loop.violations > 0 ? "bg-warning/10 text-warning" : "bg-surface-2/60",
            )}
          >
            <p className="text-[10px] uppercase tracking-wider opacity-80">Test edits reverted</p>
            <p className="tabular text-sm font-semibold" data-testid="tdd-violations">
              {loop.violations}
            </p>
          </div>
        </div>

        {loop.message ? (
          <p
            className={cn(
              "text-xs",
              loop.status === "GREEN" ? "text-success" : "text-muted-foreground",
            )}
            data-testid="tdd-message"
          >
            {loop.message}
          </p>
        ) : null}

        {loop.iterations.length > 0 ? (
          <div className="scrollbar-thin -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
            {loop.iterations.map((entry) => (
              <IterationChip
                key={entry.id}
                iteration={entry}
                selected={entry.id === iteration?.id}
                onSelect={() => setPinnedIteration(entry.id)}
              />
            ))}
          </div>
        ) : null}

        <TerminalView
          key={loop.terminalId}
          terminalId={loop.terminalId}
          interactive={false}
          className="h-72 opacity-100"
        />

        {iteration ? <IterationDetail iteration={iteration} /> : null}

        <p className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          <span>{runnerLabel(loop.runner)}</span>
          <span>{loop.workspaceName}</span>
          {loop.gates.typecheck ? <span>tsc gate</span> : null}
          {loop.gates.lint ? <span>lint gate</span> : null}
          {loop.escalatedAt ? <span className="text-architect">model escalated</span> : null}
          <span>
            started <RelativeTime iso={loop.createdAt} />
          </span>
        </p>
      </CardContent>
    </Card>
  );
}
