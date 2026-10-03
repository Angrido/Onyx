"use client";

import {
  TaskKindSchema,
  type CatalogResponse,
  type GraphResponse,
  type TaskDto,
  type TaskKind,
  type WorkspaceDto,
} from "@onyx/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileCode2, Loader2, Sparkles, X } from "lucide-react";
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
import { Field, Input, Select, Textarea } from "@/components/ui/form-controls";
import { api, errorMessage } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/keys";

const KIND_LABELS: Record<TaskKind, string> = {
  ARCHITECTURE: "Architecture",
  FEATURE: "Feature",
  REFACTOR: "Refactor",
  BUGFIX: "Bug fix",
  UI_STYLE: "UI / styling",
  TEST_FIX: "Test fix",
  DOCS: "Docs",
  CHORE: "Chore",
};

export function CreateTaskDialog({
  projectId,
  workspaces,
  catalog,
}: {
  projectId: string;
  workspaces: WorkspaceDto[];
  catalog: CatalogResponse;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [kind, setKind] = useState<TaskKind>("FEATURE");
  const [workspaceId, setWorkspaceId] = useState(workspaces[0]?.id ?? "");
  const [model, setModel] = useState("");
  const [runNow, setRunNow] = useState(true);
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

  function addTarget() {
    const value = targetDraft.trim().replace(/^\.\//, "");
    if (value.length > 0 && !targetPaths.includes(value)) setTargetPaths([...targetPaths, value]);
    setTargetDraft("");
  }

  const mutation = useMutation({
    mutationFn: async () => {
      const task = await api.post<TaskDto>("/api/tasks", {
        projectId,
        workspaceId,
        title,
        prompt,
        kind,
        targetPaths,
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
          New task
        </Button>
      </DialogTrigger>
      <DialogContent className="w-[min(94vw,40rem)]">
        <DialogHeader>
          <DialogTitle>Delegate a task</DialogTitle>
          <DialogDescription>
            The agent runs headless in the selected workspace. Leave the model empty to use the
            workspace agent default.
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={submit}>
          <Field label="Title" htmlFor="task-title">
            <Input
              id="task-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              required
            />
          </Field>
          <Field label="Prompt" htmlFor="task-prompt">
            <Textarea
              id="task-prompt"
              className="min-h-36 font-mono text-xs"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              required
            />
          </Field>
          <Field
            label="Target files"
            htmlFor="task-targets"
            hint="Sent in full; their imports and importers go in as skeletons. Leave empty to let Onyx infer targets from the prompt."
          >
            <div className="flex gap-2">
              <Input
                id="task-targets"
                list="task-target-files"
                className="font-mono text-xs"
                placeholder={
                  files.data
                    ? "src/feature/file.ts or a folder"
                    : "Index the project for suggestions"
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
                Add
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
                      aria-label={`Remove ${path}`}
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
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Workspace" htmlFor="task-workspace">
              <Select
                id="task-workspace"
                value={workspaceId}
                onChange={(event) => setWorkspaceId(event.target.value)}
              >
                {workspaces.map((workspace) => (
                  <option key={workspace.id} value={workspace.id}>
                    {workspace.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Kind" htmlFor="task-kind">
              <Select
                id="task-kind"
                value={kind}
                onChange={(event) => setKind(TaskKindSchema.parse(event.target.value))}
              >
                {TaskKindSchema.options.map((option) => (
                  <option key={option} value={option}>
                    {KIND_LABELS[option]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Model" htmlFor="task-model">
              <ModelSelect
                id="task-model"
                models={catalog.models}
                value={model}
                onChange={setModel}
                defaultLabel="Agent default"
              />
            </Field>
          </div>
          <label className="flex items-center gap-3 text-sm text-muted-foreground">
            <input
              type="checkbox"
              className="size-4 accent-[var(--primary)]"
              checked={runNow}
              onChange={(event) => setRunNow(event.target.checked)}
            />
            Run immediately
          </label>
          <DialogFooter>
            <Button type="submit" disabled={mutation.isPending || !workspaceId}>
              {mutation.isPending ? <Loader2 className="animate-spin" /> : null}
              {runNow ? "Create and run" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
