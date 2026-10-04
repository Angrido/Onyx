"use client";

import type { GitHubAccountDto } from "@onyx/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ExternalLink, KeyRound, Loader2, LogOut, XCircle } from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/form-controls";
import { GitHubMark } from "@/components/ui/github-mark";
import { api, errorMessage } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/keys";
import { GITHUB_TOKEN_URL } from "@/lib/github";

export function GitHubAccountCard({ initial }: { initial: GitHubAccountDto }) {
  const queryClient = useQueryClient();
  const [token, setToken] = useState("");
  const account = useQuery({
    queryKey: queryKeys.githubAccount,
    queryFn: () => api.get<GitHubAccountDto>("/api/github/account"),
    initialData: initial,
  });
  const data = account.data;
  const store = (next: GitHubAccountDto) => queryClient.setQueryData(queryKeys.githubAccount, next);

  const connect = useMutation({
    mutationFn: () => api.put<GitHubAccountDto>("/api/github/token", { token: token.trim() }),
    onSuccess: (next) => {
      store(next);
      setToken("");
      toast.success(`Connected to GitHub as ${next.login ?? "your account"}`);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const disconnect = useMutation({
    mutationFn: () => api.delete<GitHubAccountDto>("/api/github/token"),
    onSuccess: store,
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <Card data-testid="github-account">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <GitHubMark className="size-4" />
          GitHub
        </CardTitle>
        <CardDescription>
          Used to list and clone your repositories and to push the branches Onyx prepares.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface-0/60 px-3 py-2.5">
          {data.connected && !data.error ? (
            <CheckCircle2 className="size-4 text-success" />
          ) : (
            <XCircle className="size-4 text-muted-foreground" />
          )}
          <span className="text-sm font-medium">
            {data.connected ? (data.login ?? "Token saved") : "Not connected"}
          </span>
          {data.source === "env" ? <Badge>ONYX_GITHUB_TOKEN</Badge> : null}
          {data.error ? <span className="text-xs text-destructive">{data.error}</span> : null}
          {data.source === "settings" ? (
            <Button
              size="sm"
              variant="ghost"
              className="ml-auto"
              onClick={() => disconnect.mutate()}
              disabled={disconnect.isPending}
            >
              <LogOut />
              Disconnect
            </Button>
          ) : null}
        </div>
        {data.source !== "env" ? (
          <form
            className="space-y-2"
            onSubmit={(event: FormEvent<HTMLFormElement>) => {
              event.preventDefault();
              connect.mutate();
            }}
          >
            <Field
              label={data.connected ? "Replace the token" : "Personal access token"}
              htmlFor="settings-github-token"
              hint="Fine-grained token with Contents read and write on the repositories Onyx works on (read-only is enough to clone, write is needed to push branches), plus Pull requests read and write to open pull requests and Issues, Checks and Commit statuses read to import issues and follow the checks."
            >
              <div className="flex gap-2">
                <Input
                  id="settings-github-token"
                  type="password"
                  autoComplete="off"
                  className="font-mono text-xs"
                  placeholder="github_pat_… or ghp_…"
                  value={token}
                  onChange={(event) => setToken(event.target.value)}
                />
                <Button
                  type="submit"
                  variant="secondary"
                  disabled={connect.isPending || token.trim().length < 20}
                >
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
        ) : null}
      </CardContent>
    </Card>
  );
}
