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
import { Field, Input, Select, Textarea } from "@/components/ui/form-controls";
import { api, errorMessage } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/keys";
import { useT } from "@/lib/i18n/client";
import { KIND_LABELS, workspaceHint } from "@/lib/router";
import { ROUTING_STRATEGY_LABELS } from "@/lib/sessions";

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
      title,
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
        title,
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
    mutation.mutate();
  }

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
              "The agent runs headless in a workspace compartment. With Auto, Onyx picks the workspace that owns the target files, otherwise the one the prompt talks about, otherwise the first one; the model tier comes from the routing rules.",
            )}
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={submit}>
          <Field label={t("Title")} htmlFor="task-title">
            <Input
              id="task-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              required
            />
          </Field>
          <Field label={t("Prompt")} htmlFor="task-prompt">
            <Textarea
              id="task-prompt"
              className="min-h-36 font-mono text-xs"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              required
            />
          </Field>
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
                className="font-mono text-xs"
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
                    className="flex items-center gap-1 rounded-md bg-surface-2 py-0.5 pl-2 pr-1 font-mono text-[11px]"
                  >
                    <FileCode2 className="size-3 text-muted-foreground" />
                    {path}
                    <button
                      type="button"
                      aria-label={t("Remove {path}", { path })}
                      onClick={() => setTargetPaths(targetPaths.filter((entry) => entry !== path))}
                      className="rounded p-0.5 text-muted-foreground hover:text-foreground"
                    >
                      <X className="size-3" />
                    </button>
                  </span>
                ))}
              </div>
            ) : null}
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label={t("Workspace")} htmlFor="task-workspace">
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
            </Field>
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
            <Field label={t("Model")} htmlFor="task-model">
              <ModelSelect
                id="task-model"
                models={catalog.models}
                value={model}
                onChange={setModel}
                defaultLabel={t("Auto (router)")}
              />
            </Field>
          </div>
          {!model && routing.data ? <RoutingHint preview={routing.data} /> : null}
          <label className="flex items-center gap-3 text-sm text-muted-foreground">
            <input
              type="checkbox"
              className="size-4 accent-[var(--primary)]"
              checked={runNow}
              onChange={(event) => setRunNow(event.target.checked)}
            />
            {t("Run immediately")}
          </label>
          <label className="flex items-start gap-3 text-sm text-muted-foreground">
            <input
              type="checkbox"
              className="mt-0.5 size-4 accent-[var(--primary)]"
              checked={canWait}
              onChange={(event) => setCanWait(event.target.checked)}
              data-testid="task-can-wait"
            />
            <span>
              {t("Can wait")}
              <span className="block text-xs">
                {t("Near the Claude subscription limit it waits for the window to reset.")}
              </span>
            </span>
          </label>
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
