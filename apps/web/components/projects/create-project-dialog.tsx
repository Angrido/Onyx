"use client";

import type { ProjectDetailDto } from "@onyx/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
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
import { api, errorMessage } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/keys";

export function CreateProjectDialog({ suggestedRoot }: { suggestedRoot?: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [rootPath, setRootPath] = useState(suggestedRoot ?? "");
  const [defaults, setDefaults] = useState(true);

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
      setOpen(false);
      router.push(`/projects/${project.id}`);
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
        <Button>
          <Plus />
          New project
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Register a project</DialogTitle>
          <DialogDescription>
            Point Onyx at a repository inside the container. Agents run with this directory as their
            working directory.
          </DialogDescription>
        </DialogHeader>
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
            hint="Absolute path, e.g. /srv/onyx/projects/my-app"
          >
            <Input
              id="project-root"
              className="font-mono text-xs"
              value={rootPath}
              onChange={(event) => setRootPath(event.target.value)}
              required
            />
          </Field>
          <label className="flex items-center gap-3 text-sm text-muted-foreground">
            <input
              type="checkbox"
              className="size-4 accent-[var(--primary)]"
              checked={defaults}
              onChange={(event) => setDefaults(event.target.checked)}
            />
            Create Frontend, Backend, Database and Infra workspaces
          </label>
          <DialogFooter>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? <Loader2 className="animate-spin" /> : null}
              Register
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
