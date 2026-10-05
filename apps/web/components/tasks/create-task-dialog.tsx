"use client";

import type {
  CatalogResponse,
  GraphResponse,
  RouterPreviewResponse,
  TaskDto,
  TaskKind,
  WorkspaceDto,
} from "@onyx/contracts";
import { TASK_KINDS, oneOf } from "@onyx/contracts/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileCode2, Loader2, Route, Sparkles, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { AdvancedOptions } from "@/components/tasks/advanced-options";
import { ModelSelect } from "@/components/tasks/model-select";
import { ModelBadge, TierBadge } from "@/components/tasks/status-badge";
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
import { Field, Input, Label, Select, Textarea } from "@/components/ui/form-controls";
import { HelpTip } from "@/components/ui/help-tip";
import { api, errorMessage } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/keys";
import { useT } from "@/lib/i18n/client";
import { KIND_LABELS, workspaceHint } from "@/lib/router";
import { ROUTING_STRATEGY_LABELS } from "@/lib/sessions";
import { taskTitle, titleFromPrompt } from "@/lib/task-guide";

function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

function RoutingHint({ preview }: { preview: RouterPreviewResponse }) {
  const t = useT();
  const { decision } = preview;
  return (
    <div
      className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface-0/60 px-3 py-2 text-xs"
      data-testid="task-routing-preview"
    >
      <Route className="size-3.5 text-primary" />
      <TierBadge tier={decision.tier} />
      <ModelBadge modelId={decision.modelId} />
      <span className="text-muted-foreground">
        {t(ROUTING_STRATEGY_LABELS[decision.strategy])}
        {` · ${workspaceHint(preview.workspaceName, preview.workspaceSource, t)}`}
      </span>
      <p className="basis-full text-muted-foreground">{decision.rationale}</p>
    </div>
  );
}

export function CreateTaskDialog({
  projectId,
  workspaces,
  catalog,
}: {
  projectId: string;
  workspaces: WorkspaceDto[];
  catalog: CatalogResponse;
}) {
  const t = useT();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [kind, setKind] = useState<TaskKind>("FEATURE");
  const [workspaceId, setWorkspaceId] = useState("");
  const [model, setModel] = useState("");
  const [runNow, setRunNow] = useState(true);
  const [canWait, setCanWait] = useState(false);
  const [targetPaths, setTargetPaths] = useState<string[]>([]);
  const [targetDraft, setTargetDraft] = useState("");

  const files = useQuery({
    queryKey: queryKeys.graph(projectId, null, 0),
    queryFn: () => api.get<GraphResponse>(`/api/projects/${projectId}/graph?limit=5000`),
    enabled: open,
    retry: false,
    staleTime: 60_000,
    select: (graph) => graph.nodes.map((node) => node.id).sort(),
  });

  const previewInput = useDebounced(
    {
      projectId,
      workspaceId: workspaceId || null,
      title: taskTitle(title, prompt),
      prompt: prompt.trim(),
      kind,
      targetPaths,
    },
    700,
  );
  const routing = useQuery({
    queryKey: queryKeys.routerPreview(previewInput),
    queryFn: () => api.post<RouterPreviewResponse>("/api/router/preview", previewInput),
    enabled: open && !model && previewInput.prompt.length >= 12,
    retry: false,
    staleTime: 60_000,
  });

  function addTarget() {
    const value = targetDraft.trim().replace(/^\.\//, "");
    if (value.length > 0 && !targetPaths.includes(value)) setTargetPaths([...targetPaths, value]);
    setTargetDraft("");
  }

  const mutation = useMutation({
    mutationFn: async () => {
      const task = await api.post<TaskDto>("/api/tasks", {
        projectId,
        workspaceId: workspaceId || null,
        title: taskTitle(title, prompt),
        prompt,
        kind,
        targetPaths,
        canWait,
        ...(model ? { modelOverride: model } : {}),
      });
      if (runNow) await api.post(`/api/tasks/${task.id}/run`);
      return task;
    },
    onSuccess: (task) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.allTasks });
      setOpen(false);
      setTitle("");
      setPrompt("");
      setTargetPaths([]);
      setCanWait(false);
      router.push(`/tasks/${task.id}`);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (taskTitle(title, prompt).length === 0) return;
    mutation.mutate();
  }

  const customized =
    workspaceId !== "" || kind !== "FEATURE" || model !== "" || targetPaths.length > 0 || canWait;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button disabled={workspaces.length === 0}>
          <Sparkles />
          {t("New task")}
        </Button>
      </DialogTrigger>
      <DialogContent className="w-[min(94vw,40rem)]">
        <DialogHeader>
          <DialogTitle>{t("Delegate a task")}</DialogTitle>
          <DialogDescription>
            {t(
              "Describe the work in plain words. Onyx picks the area of the project and the model; you can change them in Advanced options.",
            )}
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={submit}>
          <Field
            label={t("What should the agent do?")}
            htmlFor="task-prompt"
            hint={t("Say what to change, where, and how you will know it works.")}
          >
            <Textarea
              id="task-prompt"
              className="min-h-36 text-sm"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder={t(
                "For example: Add a total to the cart in src/cart. Show it under the list, with two decimals. The cart tests must pass.",
              )}
              required
            />
          </Field>
          <Field
            label={t("Title (optional)")}
            htmlFor="task-title"
            hint={t("Empty: the first line of the prompt.")}
          >
            <Input
              id="task-title"
              value={title}
              maxLength={200}
              placeholder={titleFromPrompt(prompt) || t("Short name in the task list")}
              onChange={(event) => setTitle(event.target.value)}
            />
          </Field>
          <label className="flex items-center gap-3 text-sm">
            <input
              type="checkbox"
              className="size-4 accent-[var(--primary)]"
              checked={runNow}
              onChange={(event) => setRunNow(event.target.checked)}
            />
            {t("Run immediately")}
          </label>
          <AdvancedOptions
            title={t("Advanced options")}
            summary={t("Workspace, kind, model, target files, can wait")}
            defaultOpen={customized}
            variant="inline"
            testId="task-create-advanced"
          >
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center gap-0.5">
                  <Label htmlFor="task-workspace">{t("Workspace")}</Label>
                  <HelpTip term="workspace" />
                </div>
                <Select
                  id="task-workspace"
                  value={workspaceId}
                  onChange={(event) => setWorkspaceId(event.target.value)}
                >
                  <option value="">{t("Auto")}</option>
                  {workspaces.map((workspace) => (
                    <option key={workspace.id} value={workspace.id}>
                      {workspace.name}
                    </option>
                  ))}
                </Select>
              </div>
              <Field label={t("Kind")} htmlFor="task-kind">
                <Select
                  id="task-kind"
                  value={kind}
                  onChange={(event) => setKind(oneOf(TASK_KINDS, event.target.value) ?? kind)}
                >
                  {TASK_KINDS.map((option) => (
                    <option key={option} value={option}>
                      {t(KIND_LABELS[option])}
                    </option>
                  ))}
                </Select>
              </Field>
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center gap-0.5">
                  <Label htmlFor="task-model">{t("Model")}</Label>
                  <HelpTip term="router" />
                </div>
                <ModelSelect
                  id="task-model"
                  models={catalog.models}
                  value={model}
                  onChange={setModel}
                  defaultLabel={t("Auto (router)")}
                />
              </div>
            </div>
            {!model && routing.data ? <RoutingHint preview={routing.data} /> : null}
            <Field
              label={t("Target files")}
              htmlFor="task-targets"
              hint={t(
                "Sent in full; their imports and importers go in as skeletons. Leave empty to let Onyx infer targets from the prompt.",
              )}
            >
              <div className="flex gap-2">
                <Input
                  id="task-targets"
                  list="task-target-files"
                  className="min-w-0 font-mono text-xs"
                  placeholder={
                    files.data
                      ? t("src/feature/file.ts or a folder")
                      : t("Index the project for suggestions")
                  }
                  value={targetDraft}
                  onChange={(event) => setTargetDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter") return;
                    event.preventDefault();
                    addTarget();
                  }}
                />
                <Button type="button" variant="secondary" onClick={addTarget}>
                  {t("Add")}
                </Button>
              </div>
              <datalist id="task-target-files">
                {(files.data ?? []).map((file) => (
                  <option key={file} value={file} />
                ))}
              </datalist>
              {targetPaths.length > 0 ? (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {targetPaths.map((path) => (
                    <span
                      key={path}
                      className="flex max-w-full items-center gap-1 rounded-md bg-surface-2 py-0.5 pl-2 pr-1 font-mono text-[11px]"
                    >
                      <FileCode2 className="size-3 shrink-0 text-muted-foreground" />
                      <span className="truncate">{path}</span>
                      <button
                        type="button"
                        aria-label={t("Remove {path}", { path })}
                        onClick={() =>
                          setTargetPaths(targetPaths.filter((entry) => entry !== path))
                        }
                        className="rounded p-0.5 text-muted-foreground hover:text-foreground"
                      >
                        <X className="size-3" />
                      </button>
                    </span>
                  ))}
                </div>
              ) : null}
            </Field>
            <div className="flex items-start gap-3 text-sm">
              <input
                id="task-can-wait"
                type="checkbox"
                className="mt-0.5 size-4 shrink-0 accent-[var(--primary)]"
                checked={canWait}
                onChange={(event) => setCanWait(event.target.checked)}
                data-testid="task-can-wait"
              />
              <div className="min-w-0">
                <div className="flex items-center gap-0.5">
                  <label htmlFor="task-can-wait">{t("Can wait")}</label>
                  <HelpTip term="canWait" />
                </div>
                <p className="text-xs text-muted-foreground">
                  {t("Near the Claude subscription limit it waits for the window to reset.")}
                </p>
              </div>
            </div>
          </AdvancedOptions>
          <DialogFooter>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? <Loader2 className="animate-spin" /> : null}
              {runNow ? t("Create and run") : t("Create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
