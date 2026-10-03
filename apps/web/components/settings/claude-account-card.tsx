"use client";

import type { ClaudeAccountDto, ClaudeLoginDto, ClaudeTestResult } from "@onyx/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  ExternalLink,
  KeyRound,
  Loader2,
  LogIn,
  LogOut,
  Sparkles,
  Stethoscope,
  XCircle,
} from "lucide-react";
import { useCallback, useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/form-controls";
import { RelativeTime } from "@/components/ui/relative-time";
import { TerminalView } from "@/components/workspaces/terminal-view";
import { api, errorMessage } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/keys";

const SIGN_IN_URL = /https:\/\/claude\.(?:ai|com)\/[^\s"'<>]+/;

function credentialLabel(account: ClaudeAccountDto): string {
  if (!account.configured) return "Not connected";
  return account.kind === "oauth-token" ? "Claude subscription (Max or Pro)" : "Anthropic API key";
}

function LoginPanel({ login, onCancel }: { login: ClaudeLoginDto; onCancel: () => void }) {
  const [signInUrl, setSignInUrl] = useState<string | null>(null);
  const buffer = useRef("");
  const onOutput = useCallback((data: string) => {
    buffer.current = `${buffer.current}${data}`.slice(-8_000);
    const match = SIGN_IN_URL.exec(buffer.current);
    if (match) setSignInUrl(match[0]);
  }, []);
  const running = login.state === "running";

  return (
    <div className="space-y-3 rounded-lg border border-primary/30 bg-primary/5 p-3">
      <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
        <li>Open the sign-in page and log in with your Claude Max account.</li>
        <li>Claude shows a code: copy it.</li>
        <li>Click the terminal below, paste the code and press Enter.</li>
      </ol>
      <div className="flex flex-wrap items-center gap-2">
        {signInUrl ? (
          <Button asChild size="sm">
            <a href={signInUrl} target="_blank" rel="noreferrer">
              <ExternalLink />
              Open the Claude sign-in page
            </a>
          </Button>
        ) : (
          <span className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" />
            Waiting for the sign-in link…
          </span>
        )}
        {running ? (
          <Button size="sm" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
      </div>
      <TerminalView
        terminalId={login.id}
        interactive={running}
        onOutput={onOutput}
        className="h-56"
      />
    </div>
  );
}

export function ClaudeAccountCard({ initial }: { initial: ClaudeAccountDto }) {
  const queryClient = useQueryClient();
  const [token, setToken] = useState("");
  const account = useQuery({
    queryKey: queryKeys.claudeAccount,
    queryFn: () => api.get<ClaudeAccountDto>("/api/settings/claude"),
    initialData: initial,
    refetchInterval: (query) => (query.state.data?.login?.state === "running" ? 1_500 : false),
  });
  const data = account.data;
  const store = (next: ClaudeAccountDto) => queryClient.setQueryData(queryKeys.claudeAccount, next);
  const fromEnv = data.source === "env";

  const login = useMutation({
    mutationFn: () => api.post<ClaudeLoginDto>("/api/settings/claude/login"),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.claudeAccount }),
    onError: (error) => toast.error(errorMessage(error)),
  });
  const cancel = useMutation({
    mutationFn: () => api.delete<ClaudeAccountDto>("/api/settings/claude/login"),
    onSuccess: store,
  });
  const save = useMutation({
    mutationFn: () =>
      api.put<ClaudeAccountDto>("/api/settings/claude/token", { token: token.trim() }),
    onSuccess: (next) => {
      store(next);
      setToken("");
      toast.success("Claude account connected");
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const remove = useMutation({
    mutationFn: () => api.delete<ClaudeAccountDto>("/api/settings/claude/token"),
    onSuccess: (next) => {
      store(next);
      toast.success("Claude account disconnected");
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const test = useMutation({
    mutationFn: () => api.post<ClaudeTestResult>("/api/settings/claude/test"),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.claudeAccount });
      if (result.ok) toast.success(`Claude answered in ${(result.durationMs / 1000).toFixed(1)} s`);
      else toast.error(result.message);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const lastTest = data.lastTest;

  return (
    <Card data-testid="claude-account">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="size-4 text-primary" />
          Claude account
        </CardTitle>
        <CardDescription>
          Agents, terminals and roadmaps run Claude Code with this account. With Claude Max the
          usage counts against your subscription instead of API credits.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface-0/60 px-3 py-2.5">
          {data.configured ? (
            <CheckCircle2 className="size-4 text-success" />
          ) : (
            <XCircle className="size-4 text-muted-foreground" />
          )}
          <span className="text-sm font-medium" data-testid="claude-account-status">
            {credentialLabel(data)}
          </span>
          {data.source === "env" ? <Badge>from onyx.env</Badge> : null}
          {data.hint ? (
            <span className="font-mono text-xs text-muted-foreground">{data.hint}</span>
          ) : null}
          {data.savedAt ? (
            <span className="text-xs text-muted-foreground">
              saved <RelativeTime iso={data.savedAt} />
            </span>
          ) : null}
          <span className="ml-auto text-xs text-muted-foreground">
            Claude Code {data.cliVersion ?? "not found"}
          </span>
        </div>

        {lastTest ? (
          <p
            className={lastTest.ok ? "text-xs text-success" : "text-xs text-destructive"}
            data-testid="claude-last-test"
          >
            Last test <RelativeTime iso={lastTest.at} />: {lastTest.ok ? "working" : "failed"}
            {lastTest.model ? ` on ${lastTest.model}` : ""} — {lastTest.message}
          </p>
        ) : null}

        <div className="flex flex-wrap gap-2">
          {!fromEnv ? (
            <Button
              onClick={() => login.mutate()}
              disabled={login.isPending || data.login?.state === "running"}
            >
              {login.isPending ? <Loader2 className="animate-spin" /> : <LogIn />}
              {data.configured ? "Sign in again" : "Sign in with Claude"}
            </Button>
          ) : null}
          <Button
            variant="secondary"
            onClick={() => test.mutate()}
            disabled={test.isPending || !data.configured}
          >
            {test.isPending ? <Loader2 className="animate-spin" /> : <Stethoscope />}
            Test connection
          </Button>
          {data.source === "settings" ? (
            <Button variant="ghost" onClick={() => remove.mutate()} disabled={remove.isPending}>
              <LogOut />
              Disconnect
            </Button>
          ) : null}
        </div>

        {data.login && (data.login.state === "running" || data.login.state === "failed") ? (
          <LoginPanel key={data.login.id} login={data.login} onCancel={() => cancel.mutate()} />
        ) : null}
        {data.login?.state === "failed" ? (
          <p className="text-xs text-destructive">
            The sign-in did not produce a token. Try again, or paste a token below.
          </p>
        ) : null}

        {!fromEnv ? (
          <form
            className="space-y-2"
            onSubmit={(event: FormEvent<HTMLFormElement>) => {
              event.preventDefault();
              save.mutate();
            }}
          >
            <Field
              label="Or paste a token"
              htmlFor="claude-token"
              hint="Run claude setup-token on any computer where you are signed in with Claude Max and paste the sk-ant-oat01-… token. An Anthropic API key (sk-ant-api03-…) works too."
            >
              <div className="flex gap-2">
                <Input
                  id="claude-token"
                  type="password"
                  autoComplete="off"
                  className="font-mono text-xs"
                  placeholder="sk-ant-oat01-…"
                  value={token}
                  onChange={(event) => setToken(event.target.value)}
                />
                <Button
                  type="submit"
                  variant="secondary"
                  disabled={save.isPending || token.trim().length < 20}
                >
                  {save.isPending ? <Loader2 className="animate-spin" /> : <KeyRound />}
                  Save
                </Button>
              </div>
            </Field>
          </form>
        ) : (
          <p className="text-xs text-muted-foreground">
            Remove ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN from onyx.env to manage the account
            from this page.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
