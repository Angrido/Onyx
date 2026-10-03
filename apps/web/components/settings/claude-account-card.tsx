"use client";

import type {
  ClaudeAccountDto,
  ClaudeLoginDto,
  ClaudeTestResult,
  CliCompatibilityDto,
} from "@onyx/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  ExternalLink,
  KeyRound,
  Loader2,
  LogIn,
  LogOut,
  RefreshCw,
  Sparkles,
  Stethoscope,
  TriangleAlert,
  XCircle,
} from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/form-controls";
import { RelativeTime } from "@/components/ui/relative-time";
import { api, errorMessage } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/keys";

function credentialLabel(account: ClaudeAccountDto): string {
  if (!account.configured) return "Not connected";
  return account.kind === "oauth-token" ? "Claude subscription (Max or Pro)" : "Anthropic API key";
}

function SimulatorNotice({ claudeBin }: { claudeBin: string }) {
  return (
    <div
      className="flex gap-3 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm"
      data-testid="claude-simulator"
    >
      <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" />
      <div className="min-w-0 space-y-1.5">
        <p className="font-medium text-warning">Onyx is using the Claude Code simulator</p>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Agents, the sign-in and the connection test are simulated, so nothing reaches your Claude
          account and a sign-in link would be refused by claude.ai. On the Onyx machine run{" "}
          <code className="whitespace-nowrap rounded bg-surface-2 px-1.5 py-0.5 font-mono text-foreground">
            onyx use-claude
          </code>{" "}
          to install the real Claude Code and switch to it, then reload this page and sign in.
        </p>
        <p className="break-all font-mono text-[11px] text-muted-foreground" title={claudeBin}>
          CLAUDE_BIN={claudeBin}
        </p>
      </div>
    </div>
  );
}

function CompatibilityNotice({
  compatibility,
  checking,
  onCheck,
}: {
  compatibility: CliCompatibilityDto;
  checking: boolean;
  onCheck: () => void;
}) {
  const missing = [
    ...compatibility.missingFlags.map((flag) => `option ${flag}`),
    ...compatibility.missingModes.map((mode) => `permission mode ${mode}`),
    ...compatibility.missingCommands.map((command) => `command ${command}`),
  ];
  return (
    <div
      className="flex gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm"
      data-testid="claude-compatibility"
      role="alert"
    >
      <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
      <div className="min-w-0 space-y-1.5">
        <p className="font-medium text-destructive">
          Claude Code {compatibility.version ?? ""} is not compatible with this Onyx
        </p>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {missing.length > 0
            ? `It does not accept the ${missing.join(", ")} that Onyx passes, so runs would fail.`
            : (compatibility.error ?? "The check failed.")}{" "}
          Update Onyx with{" "}
          <code className="whitespace-nowrap rounded bg-surface-2 px-1.5 py-0.5 font-mono text-foreground">
            onyx-update
          </code>{" "}
          or install a version Onyx knows, for example{" "}
          <code className="whitespace-nowrap rounded bg-surface-2 px-1.5 py-0.5 font-mono text-foreground">
            claude install 2.1.288
          </code>
          .
        </p>
        <Button variant="ghost" size="sm" onClick={onCheck} disabled={checking}>
          {checking ? <Loader2 className="animate-spin" /> : <RefreshCw />}
          Check again
        </Button>
      </div>
    </div>
  );
}

function LoginPanel({
  login,
  simulator,
  onCancel,
  onSubmitted,
}: {
  login: ClaudeLoginDto;
  simulator: boolean;
  onCancel: () => void;
  onSubmitted: (account: ClaudeAccountDto) => void;
}) {
  const [code, setCode] = useState("");
  const [showOutput, setShowOutput] = useState(false);
  const running = login.state === "running";
  const submit = useMutation({
    mutationFn: () =>
      api.post<ClaudeAccountDto>("/api/settings/claude/login/code", { code: code.trim() }),
    onSuccess: (account) => {
      setCode("");
      onSubmitted(account);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const retry = useMutation({
    mutationFn: () => api.post<ClaudeAccountDto>("/api/settings/claude/login/retry"),
    onSuccess: onSubmitted,
    onError: (error) => toast.error(errorMessage(error)),
  });
  const failedAttempt = running && login.error !== null;

  return (
    <div
      className="space-y-3 rounded-lg border border-primary/30 bg-primary/5 p-3"
      data-testid="claude-login"
    >
      <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
        <li>Open the sign-in page and log in with your Claude Max account.</li>
        <li>Claude shows a code: copy all of it.</li>
        <li>Paste it below and press Connect.</li>
      </ol>
      <div className="flex flex-wrap items-center gap-2">
        {failedAttempt ? (
          <Button size="sm" onClick={() => retry.mutate()} disabled={retry.isPending}>
            {retry.isPending ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            Get a new sign-in link
          </Button>
        ) : simulator && login.signInUrl ? (
          <span className="text-xs text-warning" data-testid="claude-simulated-link">
            Simulated sign-in: no real link. Type any code below to finish.
          </span>
        ) : login.signInUrl ? (
          <Button asChild size="sm">
            <a
              href={login.signInUrl}
              target="_blank"
              rel="noreferrer"
              data-testid="claude-sign-in-link"
            >
              <ExternalLink />
              Open the Claude sign-in page
            </a>
          </Button>
        ) : running ? (
          <span className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" />
            Waiting for the sign-in link…
          </span>
        ) : null}
        {running ? (
          <Button size="sm" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
      </div>
      {failedAttempt ? (
        <p className="text-xs text-destructive" data-testid="claude-login-error">
          {login.error}. The code was not accepted: get a new link, sign in again and paste the new
          code.
        </p>
      ) : null}
      {running && !failedAttempt && login.codeSubmittedAt ? (
        <p
          className="flex items-center gap-2 text-xs text-muted-foreground"
          data-testid="claude-login-checking"
        >
          <Loader2 className="size-3.5 animate-spin" />
          Checking the code with Claude…
        </p>
      ) : null}
      {running && !failedAttempt ? (
        <form
          className="flex gap-2"
          onSubmit={(event: FormEvent<HTMLFormElement>) => {
            event.preventDefault();
            submit.mutate();
          }}
        >
          <Input
            aria-label="Code from Claude"
            className="font-mono text-xs"
            placeholder="Paste the code from the Claude page"
            autoComplete="off"
            value={code}
            onChange={(event) => setCode(event.target.value)}
          />
          <Button type="submit" disabled={submit.isPending || code.trim().length === 0}>
            {submit.isPending ? <Loader2 className="animate-spin" /> : <KeyRound />}
            Connect
          </Button>
        </form>
      ) : null}
      {login.screen ? (
        <div>
          <button
            type="button"
            onClick={() => setShowOutput((value) => !value)}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            {showOutput ? "Hide" : "Show"} the claude setup-token output
          </button>
          {showOutput ? (
            <pre className="scrollbar-thin mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-all rounded-md bg-surface-0 p-2 font-mono text-[11px] text-muted-foreground">
              {login.screen}
            </pre>
          ) : null}
        </div>
      ) : null}
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
    refetchInterval: (query) => (query.state.data?.login?.state === "running" ? 1_000 : false),
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

  const check = useMutation({
    mutationFn: () => api.post<ClaudeAccountDto>("/api/settings/claude/check"),
    onSuccess: (next) => {
      store(next);
      if (next.compatibility?.ok)
        toast.success(`Claude Code ${next.cliVersion ?? ""} is compatible`);
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
          <span className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
            Claude Code {data.cliVersion ?? "not found"}
            {data.simulator ? <Badge tone="warning">simulator</Badge> : null}
          </span>
        </div>

        {data.simulator ? <SimulatorNotice claudeBin={data.claudeBin} /> : null}
        {data.compatibility && !data.compatibility.ok ? (
          <CompatibilityNotice
            compatibility={data.compatibility}
            checking={check.isPending}
            onCheck={() => check.mutate()}
          />
        ) : null}

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
          <LoginPanel
            key={data.login.id}
            login={data.login}
            simulator={data.simulator}
            onCancel={() => cancel.mutate()}
            onSubmitted={store}
          />
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
