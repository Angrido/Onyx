"use client";

import {
  TaskKindSchema,
  type CatalogResponse,
  type TaskDto,
  type TaskKind,
  type WorkspaceDto,
} from "@onyx/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Sparkles } from "lucide-react";
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

  const mutation = useMutation({
    mutationFn: async () => {
      const task = await api.post<TaskDto>("/api/tasks", {
        projectId,
        workspaceId,
        title,
        prompt,
        kind,
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
