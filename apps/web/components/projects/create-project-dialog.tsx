"use client";

import type { ProjectDetailDto } from "@onyx/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FolderOpen, Loader2, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { GitHubImport } from "@/components/projects/github-import";
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
import { Field, Input } from "@/components/ui/form-controls";
import { GitHubMark } from "@/components/ui/github-mark";
import { api, errorMessage } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/keys";
import { cn } from "@/lib/utils";

export type ProjectSource = "github" | "local";

const SOURCES: Array<{ id: ProjectSource; label: string }> = [
  { id: "github", label: "From GitHub" },
  { id: "local", label: "Local folder" },
];

function LocalFolderForm({
  suggestedRoot,
  defaults,
  onCreated,
}: {
  suggestedRoot: string;
  defaults: boolean;
  onCreated: () => void;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [rootPath, setRootPath] = useState(suggestedRoot);

  const mutation = useMutation({
    mutationFn: () =>
      api.post<ProjectDetailDto>("/api/projects", {
        name,
        rootPath,
        createDefaultWorkspaces: defaults,
      }),
    onSuccess: (project) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.projects });
      toast.success(`Project ${project.name} registered`);
      onCreated();
      router.push(`/projects/${project.id}`);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    mutation.mutate();
  }

  return (
    <form className="space-y-4" onSubmit={submit}>
      <Field label="Name" htmlFor="project-name">
        <Input
          id="project-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
        />
      </Field>
      <Field
        label="Root path"
        htmlFor="project-root"
        hint="Absolute path of a repository already on this server, e.g. /srv/onyx/projects/my-app"
      >
        <Input
          id="project-root"
          className="font-mono text-xs"
          value={rootPath}
          onChange={(event) => setRootPath(event.target.value)}
          required
        />
      </Field>
      <DialogFooter>
        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? <Loader2 className="animate-spin" /> : null}
          Register
        </Button>
      </DialogFooter>
    </form>
  );
}

export function CreateProjectDialog({
  suggestedRoot,
  defaultOpen = false,
  defaultSource = "github",
}: {
  suggestedRoot?: string;
  defaultOpen?: boolean;
  defaultSource?: ProjectSource;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [source, setSource] = useState<ProjectSource>(defaultSource);
  const [defaults, setDefaults] = useState(true);
  const close = useCallback(() => setOpen(false), []);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus />
          New project
        </Button>
      </DialogTrigger>
      <DialogContent className="w-[min(94vw,44rem)]">
        <DialogHeader>
          <DialogTitle>Add a project</DialogTitle>
          <DialogDescription>
            Clone one of your GitHub repositories onto this server, or register a folder that is
            already here. Agents run with the project folder as their working directory.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div
            role="tablist"
            aria-label="Project source"
            className="inline-flex rounded-lg border border-border bg-surface-0/60 p-1"
          >
            {SOURCES.map((entry) => (
              <button
                key={entry.id}
                type="button"
                role="tab"
                aria-selected={source === entry.id}
                onClick={() => setSource(entry.id)}
                className={cn(
                  "flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors",
                  source === entry.id
                    ? "bg-surface-3 text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {entry.id === "github" ? (
                  <GitHubMark className="size-4" />
                ) : (
                  <FolderOpen className="size-4" />
                )}
                {entry.label}
              </button>
            ))}
          </div>
          {source === "github" ? (
            <GitHubImport defaultWorkspaces={defaults} onImported={close} />
          ) : (
            <LocalFolderForm
              suggestedRoot={suggestedRoot ?? ""}
              defaults={defaults}
              onCreated={close}
            />
          )}
          <label className="flex items-center gap-3 text-sm text-muted-foreground">
            <input
              type="checkbox"
              className="size-4 accent-[var(--primary)]"
              checked={defaults}
              onChange={(event) => setDefaults(event.target.checked)}
            />
            Create Frontend, Backend, Database and Infra workspaces
          </label>
        </div>
      </DialogContent>
    </Dialog>
  );
}
