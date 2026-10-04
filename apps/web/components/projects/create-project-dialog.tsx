"use client";

import type {
  ProjectDetailDto,
  WorkspaceProposal,
  WorkspaceProposalResponse,
} from "@onyx/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FolderOpen, Layers3, Loader2, Plus } from "lucide-react";
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
import { useT } from "@/lib/i18n/client";
import { msg } from "@/lib/i18n/core";
import { cn } from "@/lib/utils";

export type ProjectSource = "github" | "local";

const SOURCES: Array<{ id: ProjectSource; label: string }> = [
  { id: "github", label: msg("From GitHub") },
  { id: "local", label: msg("Local folder") },
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
  const t = useT();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [rootPath, setRootPath] = useState(suggestedRoot);
  const [proposal, setProposal] = useState<WorkspaceProposal[] | null>(null);
  const [skipped, setSkipped] = useState<Set<string>>(new Set());

  const preview = useMutation({
    mutationFn: () =>
      api.post<WorkspaceProposalResponse>("/api/projects/workspace-proposal", { rootPath }),
    onSuccess: (response) => {
      setProposal(response.workspaces);
      setSkipped(new Set());
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const mutation = useMutation({
    mutationFn: () =>
      api.post<ProjectDetailDto>("/api/projects", {
        name,
        rootPath,
        createDefaultWorkspaces: defaults,
        ...(defaults && proposal
          ? {
              workspaces: proposal
                .filter((workspace) => !skipped.has(workspace.name))
                .map(({ name: workspaceName, domain, pathGlobs }) => ({
                  name: workspaceName,
                  domain,
                  pathGlobs,
                })),
            }
          : { proposeWorkspaces: true }),
      }),
    onSuccess: (project) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.projects });
      toast.success(t("Project {name} registered", { name: project.name }));
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
      <Field label={t("Name")} htmlFor="project-name">
        <Input
          id="project-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
        />
      </Field>
      <Field
        label={t("Root path")}
        htmlFor="project-root"
        hint={t(
          "Absolute path of a repository already on this server, e.g. /srv/onyx/projects/my-app",
        )}
      >
        <Input
          id="project-root"
          className="font-mono text-xs"
          value={rootPath}
          onChange={(event) => {
            setRootPath(event.target.value);
            setProposal(null);
          }}
          onBlur={() => {
            if (defaults && rootPath.startsWith("/") && proposal === null && !preview.isPending)
              preview.mutate();
          }}
          required
        />
      </Field>
      {defaults ? (
        <div className="space-y-2 rounded-lg border border-border bg-surface-0/60 p-3 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="flex items-center gap-2 font-medium">
              <Layers3 className="size-3.5 text-primary" />
              {t("Workspaces from the folder structure")}
            </p>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={!rootPath.startsWith("/") || preview.isPending}
              onClick={() => preview.mutate()}
            >
              {preview.isPending ? <Loader2 className="animate-spin" /> : null}
              {proposal === null ? t("Preview") : t("Refresh")}
            </Button>
          </div>
          {proposal === null ? (
            <p className="text-muted-foreground">
              {t(
                "Onyx looks at the folders (apps, packages, src, prisma, deploy…) and proposes one workspace per area it recognises. Preview them to choose.",
              )}
            </p>
          ) : proposal.length === 0 ? (
            <p className="text-muted-foreground">{t("No workspace proposed for this folder.")}</p>
          ) : (
            <ul className="space-y-1" data-testid="workspace-proposal">
              {proposal.map((workspace) => (
                <li key={workspace.name}>
                  <label className="flex min-h-6 items-center gap-2.5">
                    <input
                      type="checkbox"
                      className="size-4 accent-[var(--primary)]"
                      checked={!skipped.has(workspace.name)}
                      onChange={(event) => {
                        const next = new Set(skipped);
                        if (event.target.checked) next.delete(workspace.name);
                        else next.add(workspace.name);
                        setSkipped(next);
                      }}
                    />
                    <span className="font-medium">{workspace.name}</span>
                    <span className="min-w-0 truncate font-mono text-[11px] text-muted-foreground">
                      {workspace.reason}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
      <DialogFooter>
        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? <Loader2 className="animate-spin" /> : null}
          {t("Register")}
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
  const t = useT();
  const [open, setOpen] = useState(defaultOpen);
  const [source, setSource] = useState<ProjectSource>(defaultSource);
  const [defaults, setDefaults] = useState(true);
  const close = useCallback(() => setOpen(false), []);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus />
          {t("New project")}
        </Button>
      </DialogTrigger>
      <DialogContent className="w-[min(94vw,44rem)]">
        <DialogHeader>
          <DialogTitle>{t("Add a project")}</DialogTitle>
          <DialogDescription>
            {t(
              "Clone one of your GitHub repositories onto this server, or register a folder that is already here. Agents run with the project folder as their working directory.",
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div
            role="tablist"
            aria-label={t("Project source")}
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
                {t(entry.label)}
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
            {t(
              "Create workspaces for the areas of the project (frontend, backend, database, infra…)",
            )}
          </label>
        </div>
      </DialogContent>
    </Dialog>
  );
}
