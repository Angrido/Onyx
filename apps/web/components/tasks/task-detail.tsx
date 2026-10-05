"use client";

import type {
  BlockedCommandsResponse,
  CatalogResponse,
  QueueDto,
  RunDto,
  RunEventsResponse,
  RunTaskResponse,
  TaskDetailDto,
  TaskDto,
  TddLoopDto,
  TddLoopListResponse,
} from "@onyx/contracts";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
} from "@tanstack/react-query";
import {
  ExternalLink,
  GitBranch,
  GitPullRequest,
  History,
  Inbox,
  Loader2,
  MessageSquarePlus,
  Play,
  RotateCcw,
  Route,
  ShieldAlert,
  ShieldCheck,
  Square,
  Upload,
} from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { TaskGitHubCard } from "@/components/github/task-github-card";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { PageHeader } from "@/components/layout/page-header";
import { RunConsole, type RunLiveState } from "@/components/runs/run-console";
import { TddLoopPanel } from "@/components/tdd/tdd-loop-panel";
import { TddStartCard } from "@/components/tdd/tdd-start-card";
import { AdvancedOptions } from "@/components/tasks/advanced-options";
import { ModelSelect } from "@/components/tasks/model-select";
import { StatusBanner } from "@/components/tasks/status-banner";
import {
  ModelBadge,
  RunStatusBadge,
  TaskStatusBadge,
  TierBadge,
} from "@/components/tasks/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Label, Select, Textarea } from "@/components/ui/form-controls";
import { HelpTip } from "@/components/ui/help-tip";
import { RelativeTime } from "@/components/ui/relative-time";
import { api, errorMessage } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/keys";
import { formatDuration, formatUsd, shortId } from "@/lib/format";
import type { GlossaryId } from "@/lib/glossary";
import { useT } from "@/lib/i18n/client";
import { useLiveTask, useQuota } from "@/lib/live";
import { formatReset } from "@/lib/quota";
import { KIND_LABELS } from "@/lib/router";
import { ROUTING_STRATEGY_LABELS } from "@/lib/sessions";
import { taskBanner, type TaskAction } from "@/lib/task-guide";
import { isLoopActive } from "@/lib/tdd";
import { cn } from "@/lib/utils";

const ACTIVE_STATUSES = new Set(["QUEUED", "RUNNING", "TDD_LOOP", "PLANNING"]);
const ADVANCED_KEY = "onyx.task.advanced";
const FOLLOW_UP_ID = "run-followup";

interface RunOptions {
  model: string;
  agentConfigId: string;
  newSession: boolean;
}

type RunMutation = UseMutationResult<RunTaskResponse, Error, string | undefined>;
type CancelMutation = UseMutationResult<TaskDto, Error, void>;

function useTaskActions(task: TaskDetailDto, options: RunOptions) {
  const t = useT();
  const queryClient = useQueryClient();
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.task(task.id) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.allTasks });
  };
  const run: RunMutation = useMutation({
    mutationFn: (prompt?: string) =>
      api.post<RunTaskResponse>(`/api/tasks/${task.id}/run`, {
        ...(options.model ? { modelId: options.model } : {}),
        ...(options.agentConfigId ? { agentConfigId: options.agentConfigId } : {}),
        ...(prompt ? { prompt } : {}),
        newSession: options.newSession,
      }),
    onSuccess: (response) => {
      if (response.queuePosition > 0)
        toast.info(t("Queued at position {position}", { position: response.queuePosition }));
      invalidate();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const cancel: CancelMutation = useMutation({
    mutationFn: () => api.post<TaskDto>(`/api/tasks/${task.id}/cancel`),
    onSuccess: invalidate,
    onError: (error) => toast.error(errorMessage(error)),
  });
  return { run, cancel };
}

function OptionLabel({
  htmlFor,
  label,
  term,
}: {
  htmlFor: string;
  label: string;
  term: GlossaryId;
}) {
  return (
    <div className="flex items-center gap-0.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      <HelpTip term={term} />
    </div>
  );
}

function focusFollowUp() {
  const field = document.getElementById(FOLLOW_UP_ID);
  field?.scrollIntoView({ behavior: "smooth", block: "center" });
  field?.focus({ preventScroll: true });
}

function BannerActions({
  task,
  actions,
  run,
  cancel,
}: {
  task: TaskDetailDto;
  actions: TaskAction[];
  run: RunMutation;
  cancel: CancelMutation;
}) {
  const t = useT();
  const running = run.isPending ? <Loader2 className="animate-spin" /> : null;
  return actions.map((action) => {
    switch (action) {
      case "start":
        return (
          <Button
            key={action}
            size="sm"
            disabled={run.isPending}
            onClick={() => run.mutate(undefined)}
          >
            {running ?? <Play />}
            {t("Start")}
          </Button>
        );
      case "retry":
        return (
          <Button
            key={action}
            size="sm"
            disabled={run.isPending}
            onClick={() => run.mutate(undefined)}
          >
            {running ?? <RotateCcw />}
            {t("Try again")}
          </Button>
        );
      case "relaunch":
        return (
          <Button
            key={action}
            size="sm"
            disabled={run.isPending}
            onClick={() => run.mutate(undefined)}
          >
            {running ?? <RotateCcw />}
            {t("Relaunch")}
          </Button>
        );
      case "rerun":
        return (
          <Button
            key={action}
            size="sm"
            disabled={run.isPending}
            onClick={() => run.mutate(undefined)}
          >
            {running ?? <RotateCcw />}
            {t("Run again")}
          </Button>
        );
      case "stop":
        return (
          <Button
            key={action}
            size="sm"
            variant="secondary"
            disabled={cancel.isPending}
            onClick={() => cancel.mutate()}
          >
            {cancel.isPending ? <Loader2 className="animate-spin" /> : <Square />}
            {t("Stop")}
          </Button>
        );
      case "allow":
        return (
          <Button key={action} size="sm" asChild>
            <a
              href="#blocked-commands"
              onClick={() => {
                window.setTimeout(() => document.getElementById("blocked-commands")?.focus(), 0);
              }}
            >
              <ShieldCheck />
              {t("Choose the commands")}
            </a>
          </Button>
        );
      case "approvals":
        return (
          <Button key={action} size="sm" variant="secondary" asChild>
            <Link href="/approvals">
              <Inbox />
              {t("Open Approvals")}
            </Link>
          </Button>
        );
      case "limits":
        return (
          <Button key={action} size="sm" variant="secondary" asChild>
            <Link href="/telemetry#quota">{t("See the limits")}</Link>
          </Button>
        );
      case "publish":
        return (
          <Button key={action} size="sm" asChild>
            <Link href={`/projects/${task.projectId}`}>
              <Upload />
              {t("Publish from the project")}
            </Link>
          </Button>
        );
      case "viewPullRequest":
        return task.pullRequest ? (
          <Button key={action} size="sm" asChild>
            <a href={task.pullRequest.url} target="_blank" rel="noreferrer">
              <ExternalLink />
              {t("View the pull request")}
            </a>
          </Button>
        ) : null;
      case "openPullRequest":
        return task.branchName ? (
          <Button key={action} size="sm" asChild>
            <Link
              href={`/projects/${task.projectId}/github?branch=${encodeURIComponent(task.branchName)}#pull-requests`}
            >
              <GitPullRequest />
              {t("Open a pull request")}
            </Link>
          </Button>
        ) : null;
      case "followUp":
        return (
          <Button key={action} size="sm" variant="secondary" onClick={focusFollowUp}>
            <MessageSquarePlus />
            {t("Ask for more")}
          </Button>
        );
    }
  });
}

function ChangedFiles({ files }: { files: readonly string[] }) {
  const t = useT();
  if (files.length === 0) return null;
  return (
    <details className="text-xs" data-testid="task-changed-files">
      <summary className="inline-flex min-h-6 cursor-pointer items-center text-muted-foreground hover:text-foreground">
        {files.length === 1
          ? t("Show the changed file")
          : t("Show the {count} changed files", { count: files.length })}
      </summary>
      <ul className="mt-1.5 space-y-0.5 font-mono text-[11px]">
        {files.slice(0, 12).map((file) => (
          <li key={file} className="truncate" title={file}>
            {file}
          </li>
        ))}
        {files.length > 12 ? (
          <li className="text-muted-foreground">
            {t("+{count} more", { count: files.length - 12 })}
          </li>
        ) : null}
      </ul>
    </details>
  );
}

function TaskStatusBanner({
  task,
  loops,
  activity,
  blocked,
  run,
  cancel,
}: {
  task: TaskDetailDto;
  loops: TddLoopDto[];
  activity: string | null;
  blocked: BlockedCommandsResponse | null;
  run: RunMutation;
  cancel: CancelMutation;
}) {
  const t = useT();
  const latest = task.runs[0] ?? null;
  const latestDone = latest !== null && latest.status !== "RUNNING" && latest.status !== "SPAWNING";
  const { data: blockedData } = useQuery({
    queryKey: queryKeys.runBlocked(latest?.id ?? ""),
    queryFn: () => api.get<BlockedCommandsResponse>(`/api/runs/${latest?.id ?? ""}/blocked`),
    enabled: latestDone && (latest?.guardDenials ?? 0) > 0,
    ...(blocked && blocked.runId === latest?.id ? { initialData: blocked } : {}),
  });
  const queued = task.status === "QUEUED";
  const { data: queue } = useQuery({
    queryKey: queryKeys.queue,
    queryFn: () => api.get<QueueDto>("/api/queue"),
    enabled: queued,
    refetchInterval: queued ? 10_000 : false,
  });
  const { data: quota } = useQuota();
  const item = queued ? queue?.items.find((entry) => entry.taskId === task.id) : undefined;
  const quotaHeld =
    queued &&
    (quota?.level === "LIMITED" ||
      (quota?.level === "HOLDING" && task.canWait && quota.settings.deferEnabled));
  const loop = loops.find(isLoopActive) ?? null;
  const banner = taskBanner({
    status: task.status,
    run: latest,
    blockedCommands: latestDone ? (blockedData?.commands.length ?? 0) : 0,
    waiting: item?.waiting ?? null,
    queuePosition: item?.position ?? null,
    quotaHeld,
    resetLabel: quotaHeld && quota?.nextResetAt ? formatReset(quota.nextResetAt, t) : null,
    activity,
    loop,
    hasPullRequest: task.pullRequest !== null,
    branchName: task.branchName,
  });
  return (
    <StatusBanner
      banner={banner}
      testId={quotaHeld ? "quota-held" : "task-status-banner"}
      extra={
        task.status === "COMPLETED" && latest ? <ChangedFiles files={latest.changedFiles} /> : null
      }
    >
      {banner.actions.length > 0 ? (
        <BannerActions task={task} actions={banner.actions} run={run} cancel={cancel} />
      ) : null}
    </StatusBanner>
  );
}

function DispatchCard({
  task,
  run,
  cancel,
}: {
  task: TaskDetailDto;
  run: RunMutation;
  cancel: CancelMutation;
}) {
  const t = useT();
  const [followUp, setFollowUp] = useState("");
  const active = ACTIVE_STATUSES.has(task.status);
  const hasRuns = task.runs.length > 0;

  return (
    <Card data-testid="task-dispatch">
      <CardHeader>
        <CardTitle>{hasRuns ? t("Ask for more") : t("Start")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {hasRuns ? (
          <Field
            label={t("What should the agent do now?")}
            htmlFor={FOLLOW_UP_ID}
            hint={t("Empty re-sends the original task prompt.")}
          >
            <Textarea
              id={FOLLOW_UP_ID}
              className="min-h-20 text-sm"
              placeholder={t("For example: also add a test for the empty cart.")}
              value={followUp}
              onChange={(event) => setFollowUp(event.target.value)}
            />
          </Field>
        ) : (
          <p className="text-xs text-muted-foreground">
            {t(
              "An agent starts from the prompt of the task. You can change model and more in Advanced options.",
            )}
          </p>
        )}
        <div className="flex gap-2">
          <Button
            className="flex-1"
            disabled={active || run.isPending}
            onClick={() =>
              run.mutate(followUp.trim() || undefined, { onSuccess: () => setFollowUp("") })
            }
          >
            {run.isPending ? <Loader2 className="animate-spin" /> : null}
            {!run.isPending && hasRuns ? <RotateCcw /> : null}
            {!run.isPending && !hasRuns ? <Play /> : null}
            {hasRuns ? t("Run again") : t("Start")}
          </Button>
          {active ? (
            <Button
              variant="destructive"
              disabled={cancel.isPending}
              onClick={() => cancel.mutate()}
            >
              {cancel.isPending ? <Loader2 className="animate-spin" /> : <Square />}
              {t("Stop")}
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

function RunOptionsFields({
  task,
  catalog,
  options,
  onChange,
}: {
  task: TaskDetailDto;
  catalog: CatalogResponse;
  options: RunOptions;
  onChange: (options: RunOptions) => void;
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const wait = useMutation({
    mutationFn: (canWait: boolean) => api.patch<TaskDto>(`/api/tasks/${task.id}`, { canWait }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.task(task.id) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.allTasks });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  return (
    <section className="space-y-4" aria-labelledby="run-options-title">
      <h3 id="run-options-title" className="text-sm font-semibold">
        {t("How the agent runs")}
      </h3>
      <div className="flex flex-col gap-1.5">
        <OptionLabel htmlFor="run-model" label={t("Model")} term="router" />
        <ModelSelect
          id="run-model"
          models={catalog.models}
          value={options.model}
          onChange={(model) => onChange({ ...options, model })}
          defaultLabel={t("Auto (router)")}
        />
        <p className="text-xs text-muted-foreground">
          {t("Auto lets Onyx pick the cheapest model that should finish the task.")}
        </p>
      </div>
      <Field
        label={t("Agent profile")}
        htmlFor="run-agent"
        hint={t(
          "Which tools and permissions the agent has. The workspace default suits most tasks.",
        )}
      >
        <Select
          id="run-agent"
          value={options.agentConfigId}
          onChange={(event) => onChange({ ...options, agentConfigId: event.target.value })}
        >
          <option value="">{t("Workspace default")}</option>
          {catalog.agentConfigs.map((config) => (
            <option key={config.id} value={config.id}>
              {config.name} · {config.permissionMode}
            </option>
          ))}
        </Select>
      </Field>
      <div className="flex items-start gap-3 text-sm">
        <input
          id="run-new-session"
          type="checkbox"
          className="mt-0.5 size-4 shrink-0 accent-[var(--primary)]"
          checked={options.newSession}
          onChange={(event) => onChange({ ...options, newSession: event.target.checked })}
        />
        <div className="min-w-0">
          <div className="flex items-center gap-0.5">
            <label htmlFor="run-new-session">{t("Start with a clean context")}</label>
            <HelpTip term="session" />
          </div>
          <p className="text-xs text-muted-foreground">
            {t(
              "A new Claude conversation instead of the previous one: costs more, helps when the agent got confused.",
            )}
          </p>
        </div>
      </div>
      <div className="flex items-start gap-3 text-sm">
        <input
          id="run-can-wait"
          type="checkbox"
          className="mt-0.5 size-4 shrink-0 accent-[var(--primary)]"
          checked={wait.isPending ? (wait.variables ?? task.canWait) : task.canWait}
          disabled={wait.isPending}
          onChange={(event) => wait.mutate(event.target.checked)}
          data-testid="task-can-wait"
        />
        <div className="min-w-0">
          <div className="flex items-center gap-0.5">
            <label htmlFor="run-can-wait">{t("Can wait")}</label>
            <HelpTip term="canWait" />
          </div>
          <p className="text-xs text-muted-foreground">
            {t("Near the Claude subscription limit it waits for the window to reset.")}
          </p>
        </div>
      </div>
    </section>
  );
}

function RoutingDetails({ task, run }: { task: TaskDetailDto; run: RunDto | null }) {
  const t = useT();
  const workspaceHref = task.workspaceId
    ? `/projects/${task.projectId}/workspaces/${task.workspaceId}`
    : null;
  return (
    <section
      className="space-y-3 text-xs"
      data-testid="task-routing"
      aria-labelledby="routing-title"
    >
      <h3 id="routing-title" className="flex items-center gap-1.5 text-sm font-semibold">
        <Route className="size-4 text-muted-foreground" aria-hidden="true" />
        {t("Model choice")}
        <HelpTip term="router" />
      </h3>
      {run?.routing ? (
        <>
          <div className="flex flex-wrap items-center gap-1.5">
            <TierBadge tier={run.routing.tier} />
            <HelpTip term="tier" />
            <ModelBadge modelId={run.modelId} />
            <Badge>{t(ROUTING_STRATEGY_LABELS[run.routing.strategy])}</Badge>
          </div>
          <p className="leading-relaxed text-muted-foreground">{run.routing.rationale}</p>
        </>
      ) : (
        <p className="text-muted-foreground">
          {task.modelOverride
            ? t("Pinned to {model}.", { model: task.modelOverride })
            : t("The router decides when the task is dispatched.")}
        </p>
      )}
      {workspaceHref ? (
        <div className="flex items-center gap-0.5">
          <Link
            href={workspaceHref}
            className="flex min-w-0 flex-1 items-center gap-2 rounded-md bg-surface-2 px-2.5 py-1.5 hover:text-foreground"
          >
            <GitBranch className="size-3.5 shrink-0 text-info" aria-hidden="true" />
            <span className="text-muted-foreground">{t("Workspace sessions")}</span>
            {run ? (
              <span className="ml-auto font-mono" title={run.sessionId}>
                {shortId(run.sessionId)}
              </span>
            ) : null}
          </Link>
          <HelpTip term="handoff" />
        </div>
      ) : null}
    </section>
  );
}

function RunHistory({
  runs,
  selected,
  onSelect,
}: {
  runs: RunDto[];
  selected: string | null;
  onSelect: (runId: string) => void;
}) {
  const t = useT();
  return (
    <Card>
      <CardHeader className="flex-row items-center gap-2">
        <History className="size-4 text-muted-foreground" />
        <CardTitle>{t("Runs")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1.5">
        {runs.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t("No runs yet.")}</p>
        ) : null}
        {runs.map((run) => (
          <button
            key={run.id}
            type="button"
            onClick={() => onSelect(run.id)}
            aria-pressed={selected === run.id}
            className={cn(
              "relative flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-xs transition-colors",
              selected === run.id
                ? "text-foreground"
                : "text-muted-foreground hover:bg-surface-2/60",
            )}
          >
            {selected === run.id ? (
              <motion.span
                layoutId="run-selected"
                className="absolute inset-0 rounded-lg border border-border-strong bg-surface-2"
                transition={{ type: "spring", stiffness: 420, damping: 34 }}
              />
            ) : null}
            <span className="relative flex min-w-0 flex-1 flex-col gap-1">
              <span className="flex flex-wrap items-center gap-2">
                <RunStatusBadge status={run.status} />
                <ModelBadge modelId={run.modelId} />
                {run.routing?.strategy === "ESCALATION" ? (
                  <Badge tone="warning">{t("escalated")}</Badge>
                ) : null}
              </span>
              <span className="truncate">{run.prompt}</span>
            </span>
            <span className="relative flex flex-col items-end gap-1 tabular">
              <span>{formatUsd(run.costUsd)}</span>
              <span>{formatDuration(run.durationMs)}</span>
            </span>
          </button>
        ))}
      </CardContent>
    </Card>
  );
}

export function TaskDetail({
  initial,
  initialLoops,
  initialBlocked = null,
  initialEvents = null,
  catalog,
  projectName,
}: {
  initial: TaskDetailDto;
  initialLoops: TddLoopDto[];
  initialBlocked?: BlockedCommandsResponse | null;
  initialEvents?: RunEventsResponse | null;
  catalog: CatalogResponse;
  projectName: string;
}) {
  const t = useT();
  useLiveTask(initial.id);
  const { data: task } = useQuery({
    queryKey: queryKeys.task(initial.id),
    queryFn: () => api.get<TaskDetailDto>(`/api/tasks/${initial.id}`),
    initialData: initial,
  });
  const { data: loops = [] } = useQuery({
    queryKey: queryKeys.tddLoops(initial.id),
    queryFn: () =>
      api.get<TddLoopListResponse>(`/api/tasks/${initial.id}/tdd`).then((page) => page.items),
    initialData: initialLoops,
  });
  const [options, setOptions] = useState<RunOptions>({
    model: initial.modelOverride ?? "",
    agentConfigId: "",
    newSession: false,
  });
  const { run, cancel } = useTaskActions(task, options);
  const [live, setLive] = useState<RunLiveState | null>(null);
  const onLive = useCallback((state: RunLiveState) => setLive(state), []);
  const loopRunning = loops.some(isLoopActive);
  const [pinnedRun, setPinnedRun] = useState<string | null>(null);
  const latestRun = task.runs[0] ?? null;
  const selectedRun = task.runs.find((entry) => entry.id === pinnedRun) ?? latestRun;
  const custom =
    options.model !== "" || options.agentConfigId !== "" || options.newSession || task.canWait;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={
          <Breadcrumbs
            label={t("Breadcrumb")}
            items={[
              { label: t("Projects"), href: "/projects" },
              { label: projectName, href: `/projects/${task.projectId}` },
              { label: task.title },
            ]}
          />
        }
        title={task.title}
        description={
          <>
            {t(KIND_LABELS[task.kind]).toLowerCase()} · {t("updated")}{" "}
            <RelativeTime iso={task.updatedAt} />
          </>
        }
        actions={<TaskStatusBadge status={task.status} />}
      />
      <TaskStatusBanner
        task={task}
        loops={loops}
        activity={selectedRun?.id === latestRun?.id ? (live?.tool ?? null) : null}
        blocked={initialBlocked}
        run={run}
        cancel={cancel}
      />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>{t("Prompt")}</CardTitle>
            </CardHeader>
            <CardContent>
              {task.issue ? (
                <p
                  className="mb-3 flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-foreground"
                  data-testid="issue-notice"
                >
                  <ShieldAlert className="mt-0.5 size-3.5 shrink-0 text-warning" />
                  {t(
                    "The text between the issue tags comes from GitHub issue #{number}, not from you. Read it before dispatching: the agent is told to treat it as a description, not as instructions.",
                    { number: task.issue.number },
                  )}
                </p>
              ) : null}
              <p className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-muted-foreground">
                {task.prompt}
              </p>
              {task.targetPaths.length > 0 ? (
                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  <span className="flex items-center text-[11px] uppercase tracking-wider text-muted-foreground">
                    {t("Targets")}
                    <HelpTip term="context" />
                  </span>
                  {task.targetPaths.map((path) => (
                    <Link
                      key={path}
                      href={`/projects/${task.projectId}/graph?focus=${encodeURIComponent(path)}`}
                      className="max-w-full truncate rounded-md bg-surface-2 px-2 py-0.5 font-mono text-[11px] hover:text-foreground"
                    >
                      {path}
                    </Link>
                  ))}
                </div>
              ) : null}
            </CardContent>
          </Card>
          {loops.length > 0 ? <TddLoopPanel taskId={task.id} loops={loops} /> : null}
          {selectedRun ? (
            <RunConsole
              key={selectedRun.id}
              run={selectedRun}
              blocked={initialBlocked?.runId === selectedRun.id ? initialBlocked : null}
              events={selectedRun.id === initial.runs[0]?.id ? initialEvents : null}
              className="h-[70vh]"
              onLive={onLive}
            />
          ) : (
            <Card className="grid h-64 place-items-center p-6 text-center text-sm text-muted-foreground">
              {t("Dispatch the task to start an agent.")}
            </Card>
          )}
        </div>
        <div className="min-w-0 space-y-6">
          <DispatchCard task={task} run={run} cancel={cancel} />
          <TaskGitHubCard task={task} />
          <RunHistory
            runs={task.runs}
            selected={selectedRun?.id ?? null}
            onSelect={(runId) => setPinnedRun(runId === latestRun?.id ? null : runId)}
          />
          <AdvancedOptions
            title={t("Advanced options")}
            summary={custom ? t("Changed options") : t("Model, profile, TDD loop")}
            storageKey={ADVANCED_KEY}
            testId="task-advanced"
          >
            <RunOptionsFields
              task={task}
              catalog={catalog}
              options={options}
              onChange={setOptions}
            />
            <RoutingDetails task={task} run={selectedRun} />
            {loopRunning ? null : (
              <TddStartCard task={task} disabled={ACTIVE_STATUSES.has(task.status)} bare />
            )}
          </AdvancedOptions>
        </div>
      </div>
    </div>
  );
}
