"use client";

import type {
  CloneJobDto,
  GitHubAccountDto,
  GitHubRepoDto,
  GitHubRepoListResponse,
} from "@onyx/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  CheckCircle2,
  Download,
  ExternalLink,
  GitFork,
  KeyRound,
  Loader2,
  Lock,
  LogOut,
  RefreshCw,
  Search,
  XCircle,
} from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { GitHubMark } from "@/components/ui/github-mark";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form-controls";
import { RelativeTime } from "@/components/ui/relative-time";
import { api, errorMessage } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/keys";
import { GITHUB_TOKEN_URL, filterRepos, formatRepoSize, projectNameFor } from "@/lib/github";
import { cn } from "@/lib/utils";

const ACTIVE_STATES = new Set(["cloning", "registering"]);

function ConnectPanel({ onOwner }: { onOwner: (owner: string) => void }) {
  const queryClient = useQueryClient();
  const [token, setToken] = useState("");
  const [owner, setOwner] = useState("");
  const connect = useMutation({
    mutationFn: () => api.put<GitHubAccountDto>("/api/github/token", { token: token.trim() }),
    onSuccess: (account) => {
      queryClient.setQueryData(queryKeys.githubAccount, account);
      setToken("");
      toast.success(`Connected to GitHub as ${account.login ?? "your account"}`);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <div className="space-y-4">
      <form
        className="space-y-2 rounded-lg border border-border bg-surface-0/60 p-3"
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault();
          connect.mutate();
        }}
      >
        <Field
          label="GitHub token"
          htmlFor="github-token"
          hint="Fine-grained token with Contents access on the repositories you want: read-only is enough to clone, read and write lets Onyx push branches. A classic token needs the repo scope. It is stored on this Onyx server and never shown again."
        >
          <div className="flex gap-2">
            <Input
              id="github-token"
              type="password"
              autoComplete="off"
              className="font-mono text-xs"
              placeholder="github_pat_… or ghp_…"
              value={token}
              onChange={(event) => setToken(event.target.value)}
            />
            <Button type="submit" disabled={connect.isPending || token.trim().length < 20}>
              {connect.isPending ? <Loader2 className="animate-spin" /> : <KeyRound />}
              Connect
            </Button>
          </div>
        </Field>
        <a
          href={GITHUB_TOKEN_URL}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
        >
          Create a token on GitHub
          <ExternalLink className="size-3" />
        </a>
      </form>
      <form
        className="flex items-end gap-2"
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault();
          if (owner.trim()) onOwner(owner.trim());
        }}
      >
        <div className="flex-1">
          <Field
            label="Or browse public repositories of"
            htmlFor="github-owner"
            hint="No token needed for public repositories."
          >
            <Input
              id="github-owner"
              placeholder="GitHub user or organization"
              value={owner}
              onChange={(event) => setOwner(event.target.value)}
            />
          </Field>
        </div>
        <Button type="submit" variant="secondary" className="mb-6" disabled={!owner.trim()}>
          Browse
        </Button>
      </form>
    </div>
  );
}

function AccountBar({
  account,
  owner,
  onOwner,
  onRefresh,
  refreshing,
}: {
  account: GitHubAccountDto;
  owner: string;
  onOwner: (owner: string) => void;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(owner);
  const disconnect = useMutation({
    mutationFn: () => api.delete<GitHubAccountDto>("/api/github/token"),
    onSuccess: (next) => {
      queryClient.setQueryData(queryKeys.githubAccount, next);
      onOwner("");
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface-0/60 px-3 py-2">
      {account.avatarUrl ? (
        <span
          className="size-6 shrink-0 rounded-full bg-surface-2 bg-cover"
          style={{ backgroundImage: `url(${JSON.stringify(account.avatarUrl)})` }}
        />
      ) : (
        <GitHubMark className="size-4 text-muted-foreground" />
      )}
      <span className="text-sm font-medium">{account.login ?? "GitHub"}</span>
      {account.source === "env" ? <Badge>ONYX_GITHUB_TOKEN</Badge> : null}
      {account.error ? <span className="text-xs text-destructive">{account.error}</span> : null}
      <form
        className="order-last flex w-full items-center gap-1.5 sm:order-none sm:ml-auto sm:w-auto"
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault();
          onOwner(draft.trim());
        }}
      >
        <Input
          aria-label="GitHub user or organization"
          className="h-8 flex-1 text-xs sm:w-40 sm:flex-none"
          placeholder="Other user or org"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        {owner ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              setDraft("");
              onOwner("");
            }}
          >
            Mine
          </Button>
        ) : null}
      </form>
      <div className="ml-auto flex items-center sm:ml-0">
        <Button
          size="icon"
          variant="ghost"
          aria-label="Refresh repositories"
          onClick={onRefresh}
          disabled={refreshing}
        >
          <RefreshCw className={cn(refreshing && "animate-spin")} />
        </Button>
        {account.source === "settings" ? (
          <Button
            size="icon"
            variant="ghost"
            aria-label="Disconnect GitHub"
            onClick={() => disconnect.mutate()}
            disabled={disconnect.isPending}
          >
            <LogOut />
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function RepoRow({
  repo,
  selected,
  onSelect,
}: {
  repo: GitHubRepoDto;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        className={cn(
          "flex w-full flex-col gap-1 rounded-lg border px-3 py-2 text-left transition-colors",
          selected
            ? "border-primary/50 bg-primary/10"
            : "border-transparent hover:border-border hover:bg-surface-2/60",
        )}
      >
        <span className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
          <span className="truncate font-medium">{repo.fullName}</span>
          {repo.private ? (
            <Badge>
              <Lock className="size-3" />
              private
            </Badge>
          ) : null}
          {repo.fork ? (
            <Badge>
              <GitFork className="size-3" />
              fork
            </Badge>
          ) : null}
          {repo.archived ? (
            <Badge tone="warning">
              <Archive className="size-3" />
              archived
            </Badge>
          ) : null}
          {repo.importedProjectId ? <Badge tone="success">imported</Badge> : null}
        </span>
        {repo.description ? (
          <span className="line-clamp-1 text-xs text-muted-foreground">{repo.description}</span>
        ) : null}
        <span className="flex flex-wrap gap-x-3 text-[11px] text-muted-foreground">
          {repo.language ? <span>{repo.language}</span> : null}
          <span>{formatRepoSize(repo.sizeKb)}</span>
          {repo.pushedAt ? (
            <span>
              pushed <RelativeTime iso={repo.pushedAt} />
            </span>
          ) : null}
        </span>
      </button>
    </li>
  );
}

function ImportProgress({ job }: { job: CloneJobDto }) {
  const failed = job.state === "failed";
  const done = job.state === "done";
  return (
    <div
      className={cn(
        "space-y-2 rounded-lg border p-3 text-sm",
        failed ? "border-destructive/40 bg-destructive/8" : "border-border bg-surface-0/60",
      )}
      data-testid="github-import-progress"
    >
      <div className="flex items-center gap-2">
        {failed ? (
          <XCircle className="size-4 text-destructive" />
        ) : done ? (
          <CheckCircle2 className="size-4 text-success" />
        ) : (
          <Loader2 className="size-4 animate-spin text-primary" />
        )}
        <span className="font-medium">
          {failed
            ? `Could not import ${job.fullName}`
            : done
              ? `${job.fullName} imported`
              : `${job.phase ?? "Cloning"} ${job.fullName}`}
        </span>
        {job.percent !== null && !done && !failed ? (
          <span className="tabular ml-auto text-xs text-muted-foreground">{job.percent}%</span>
        ) : null}
      </div>
      {!failed ? (
        <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
          <motion.div
            className="h-full rounded-full bg-primary"
            initial={false}
            animate={{ width: done ? "100%" : `${job.percent ?? 8}%` }}
          />
        </div>
      ) : null}
      <p className="font-mono text-[11px] text-muted-foreground">{job.targetPath}</p>
      {job.error ? <p className="text-xs text-destructive">{job.error}</p> : null}
    </div>
  );
}

export function GitHubImport({
  defaultWorkspaces,
  onImported,
}: {
  defaultWorkspaces: boolean;
  onImported: () => void;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [owner, setOwner] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<GitHubRepoDto | null>(null);
  const [name, setName] = useState("");
  const [branch, setBranch] = useState("");
  const [jobId, setJobId] = useState<string | null>(null);

  const account = useQuery({
    queryKey: queryKeys.githubAccount,
    queryFn: () => api.get<GitHubAccountDto>("/api/github/account"),
  });
  const browsing = account.data?.connected === true || owner.length > 0;
  const repos = useQuery({
    queryKey: queryKeys.githubRepos(owner),
    queryFn: () =>
      api.get<GitHubRepoListResponse>(
        `/api/github/repos${owner ? `?owner=${encodeURIComponent(owner)}` : ""}`,
      ),
    enabled: browsing && account.isSuccess,
    retry: false,
    staleTime: 60_000,
  });
  const job = useQuery({
    queryKey: queryKeys.githubImport(jobId ?? ""),
    queryFn: () => api.get<CloneJobDto>(`/api/github/imports/${jobId ?? ""}`),
    enabled: jobId !== null,
    refetchInterval: (query) =>
      query.state.data && !ACTIVE_STATES.has(query.state.data.state) ? false : 700,
  });

  const visible = useMemo(() => filterRepos(repos.data?.items ?? [], search), [repos.data, search]);

  const start = useMutation({
    mutationFn: () => {
      if (!selected) throw new Error("Choose a repository");
      return api.post<CloneJobDto>("/api/github/imports", {
        fullName: selected.fullName,
        name: name.trim() || projectNameFor(selected.name),
        ...(branch.trim() ? { branch: branch.trim() } : {}),
        createDefaultWorkspaces: defaultWorkspaces,
        proposeWorkspaces: true,
      });
    },
    onSuccess: (created) => {
      queryClient.setQueryData(queryKeys.githubImport(created.id), created);
      setJobId(created.id);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const finished = job.data?.state === "done" ? job.data : null;
  useEffect(() => {
    if (!finished?.projectId) return;
    void queryClient.invalidateQueries({ queryKey: queryKeys.projects });
    void queryClient.invalidateQueries({ queryKey: ["github", "repos"] });
    toast.success(`${finished.fullName} cloned and registered`);
    onImported();
    router.push(`/projects/${finished.projectId}`);
  }, [finished, queryClient, onImported, router]);

  const running = job.data !== undefined && ACTIVE_STATES.has(job.data.state);

  if (account.isPending) {
    return (
      <div className="grid h-40 place-items-center text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="github-import">
      {account.data?.connected ? (
        <AccountBar
          account={account.data}
          owner={owner}
          onOwner={(next) => {
            setOwner(next);
            setSelected(null);
          }}
          onRefresh={() =>
            void queryClient.fetchQuery({
              queryKey: queryKeys.githubRepos(owner),
              queryFn: () =>
                api.get<GitHubRepoListResponse>(
                  `/api/github/repos?refresh=true${owner ? `&owner=${encodeURIComponent(owner)}` : ""}`,
                ),
            })
          }
          refreshing={repos.isFetching}
        />
      ) : owner ? (
        <div className="flex items-center gap-2 text-sm">
          <GitHubMark className="size-4 text-muted-foreground" />
          Public repositories of <span className="font-medium">{owner}</span>
          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setOwner("")}>
            Connect a token instead
          </Button>
        </div>
      ) : (
        <ConnectPanel onOwner={setOwner} />
      )}

      {browsing ? (
        <div className="space-y-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-label="Search repositories"
              className="pl-9"
              placeholder="Search repositories"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          {repos.isError ? (
            <p className="text-sm text-destructive">{errorMessage(repos.error)}</p>
          ) : repos.isPending ? (
            <div className="grid h-40 place-items-center text-muted-foreground">
              <Loader2 className="size-5 animate-spin" />
            </div>
          ) : (
            <ul
              className="scrollbar-thin max-h-64 space-y-1 overflow-y-auto pr-1"
              data-testid="github-repos"
            >
              {visible.map((repo) => (
                <RepoRow
                  key={repo.fullName}
                  repo={repo}
                  selected={selected?.fullName === repo.fullName}
                  onSelect={() => {
                    setSelected(repo);
                    setName(projectNameFor(repo.name));
                    setBranch("");
                    setJobId(null);
                  }}
                />
              ))}
              {visible.length === 0 ? (
                <li className="py-6 text-center text-sm text-muted-foreground">
                  No repositories match.
                </li>
              ) : null}
            </ul>
          )}
          {repos.data?.truncated ? (
            <p className="text-xs text-muted-foreground">
              Showing the 1,000 most recently pushed repositories.
            </p>
          ) : null}
        </div>
      ) : null}

      {selected ? (
        selected.importedProjectId ? (
          <div className="flex items-center gap-2 rounded-lg border border-success/40 bg-success/8 px-3 py-2 text-sm">
            <CheckCircle2 className="size-4 text-success" />
            {selected.fullName} is already a project.
            <Button asChild size="sm" variant="secondary" className="ml-auto">
              <Link href={`/projects/${selected.importedProjectId}`} onClick={onImported}>
                Open
              </Link>
            </Button>
          </div>
        ) : (
          <form
            className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
            onSubmit={(event: FormEvent<HTMLFormElement>) => {
              event.preventDefault();
              start.mutate();
            }}
          >
            <Field label="Project name" htmlFor="import-name">
              <Input
                id="import-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
              />
            </Field>
            <Field label="Branch" htmlFor="import-branch">
              <Input
                id="import-branch"
                className="font-mono text-xs"
                placeholder={selected.defaultBranch}
                value={branch}
                onChange={(event) => setBranch(event.target.value)}
              />
            </Field>
            <Button type="submit" disabled={start.isPending || running}>
              {start.isPending || running ? <Loader2 className="animate-spin" /> : <Download />}
              Clone and register
            </Button>
          </form>
        )
      ) : null}

      {job.data ? <ImportProgress job={job.data} /> : null}
    </div>
  );
}
