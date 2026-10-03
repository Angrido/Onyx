import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_ENV_ALLOWLIST,
  PtySession,
  TextTail,
  buildChildEnv,
  type ClaudeBinary,
} from "@onyx/agent-runtime";
import {
  CLAUDE_TOKEN_PATTERN,
  ClaudeCredentialKindSchema,
  ClaudeTestResultSchema,
  type ClaudeAccountDto,
  type ClaudeCredentialKind,
  type ClaudeLoginDto,
  type ClaudeLoginState,
  type ClaudeTestResult,
  type CredentialSource,
} from "@onyx/contracts";
import type { PrismaClient } from "@onyx/db";
import type { Logger } from "pino";
import { z } from "zod";
import { credentialEnv, type AppConfig, type ClaudeCredentials } from "../config";
import { conflict, notFound } from "../errors";
import { ScreenBuffer, findLoginError, findSignInUrl } from "../infrastructure/screen-buffer";
import { ptyOutputMessage, type WsHub } from "../infrastructure/ws-hub";

export interface CredentialServiceDeps {
  prisma: PrismaClient;
  logger: Logger;
  hub: WsHub;
  binary: ClaudeBinary;
  config: Pick<AppConfig, "credentials" | "claudeBin" | "childEnvPassthrough">;
  cliVersion: () => string | null;
  sourceEnv?: NodeJS.ProcessEnv;
  killGraceMs?: number;
  testTimeoutMs?: number;
}

export interface ResolvedCredentials {
  credentials: ClaudeCredentials;
  source: CredentialSource | null;
  savedAt: Date | null;
}

interface LoginSession {
  id: string;
  pty: PtySession;
  output: TextTail;
  screen: ScreenBuffer;
  signInUrl: string | null;
  error: string | null;
  codeSubmittedAt: Date | null;
  screenText: string;
  processed: Promise<void>;
  state: ClaudeLoginState;
  exitCode: number | null;
  startedAt: Date;
  actor: string;
}

const CREDENTIAL_KEY = "claude.credential";
const TEST_KEY = "claude.lastTest";
const LOGIN_COLS = 1_000;
const PASTE_START = "\u001b[200~";
const PASTE_END = "\u001b[201~";
const SUBMIT_DELAY_MS = 300;
const EXIT_SETTLE_MS = 250;
const LOGIN_ROWS = 40;
const SCREEN_LINES = 40;
const LOGIN_OUTPUT_CHARS = 64 * 1024;
const DEFAULT_TEST_TIMEOUT_MS = 90_000;
const TEST_PROMPT = "Reply with the single word OK.";

const StoredCredentialSchema = z.object({
  kind: ClaudeCredentialKindSchema,
  value: z.string().min(1),
  savedAt: z.string(),
});

export function kindOfToken(token: string): ClaudeCredentialKind {
  return token.startsWith("sk-ant-oat") ? "oauth-token" : "api-key";
}

export function maskToken(token: string): string {
  return token.length <= 20 ? "…" : `${token.slice(0, 14)}…${token.slice(-4)}`;
}

export function findClaudeToken(output: string): string | null {
  return CLAUDE_TOKEN_PATTERN.exec(output)?.[0] ?? null;
}

export function parseCliResult(stdout: string): { isError: boolean; text: string } | null {
  let found: { isError: boolean; text: string } | null = null;
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (typeof parsed !== "object" || parsed === null || !("type" in parsed)) continue;
      if (parsed.type !== "result") continue;
      const record = parsed as { is_error?: unknown; result?: unknown };
      found = {
        isError: record.is_error === true,
        text: typeof record.result === "string" ? record.result : "",
      };
    } catch {
      continue;
    }
  }
  return found;
}

export class CredentialService {
  private login: LoginSession | null = null;

  constructor(private readonly deps: CredentialServiceDeps) {
    deps.hub.registerSnapshot("pty:", (channel) => {
      const login = this.login;
      if (!login || channel !== `pty:${login.id}`) return [];
      return [ptyOutputMessage(login.id, login.output.toString(), true)];
    });
  }

  async resolve(): Promise<ResolvedCredentials> {
    const fromEnv = this.deps.config.credentials;
    if (fromEnv.kind !== "none") return { credentials: fromEnv, source: "env", savedAt: null };
    const stored = await this.stored();
    if (!stored) return { credentials: { kind: "none" }, source: null, savedAt: null };
    return {
      credentials: { kind: stored.kind, value: stored.value },
      source: "settings",
      savedAt: new Date(stored.savedAt),
    };
  }

  async childEnv(): Promise<Record<string, string>> {
    return credentialEnv((await this.resolve()).credentials);
  }

  async account(): Promise<ClaudeAccountDto> {
    const resolved = await this.resolve();
    const credentials = resolved.credentials;
    const testRow = await this.deps.prisma.appSetting.findUnique({ where: { key: TEST_KEY } });
    const lastTest = ClaudeTestResultSchema.safeParse(testRow?.value);
    return {
      configured: credentials.kind !== "none",
      source: resolved.source,
      kind: credentials.kind === "none" ? null : credentials.kind,
      hint: credentials.kind === "none" ? null : maskToken(credentials.value),
      savedAt: resolved.savedAt?.toISOString() ?? null,
      cliVersion: this.deps.cliVersion(),
      claudeBin: this.deps.config.claudeBin,
      simulator: this.isSimulator(),
      login: this.login ? this.toLoginDto(this.login) : null,
      lastTest: lastTest.success ? lastTest.data : null,
    };
  }

  async save(token: string, actor: string): Promise<ClaudeAccountDto> {
    this.assertNotFromEnv();
    const value = { kind: kindOfToken(token), value: token, savedAt: new Date().toISOString() };
    await this.deps.prisma.appSetting.upsert({
      where: { key: CREDENTIAL_KEY },
      create: { key: CREDENTIAL_KEY, value },
      update: { value },
    });
    await this.deps.prisma.appSetting.deleteMany({ where: { key: TEST_KEY } });
    await this.audit(actor, "claude.credential.saved", { kind: value.kind });
    return this.account();
  }

  async remove(actor: string): Promise<ClaudeAccountDto> {
    this.assertNotFromEnv();
    await this.deps.prisma.appSetting.deleteMany({
      where: { key: { in: [CREDENTIAL_KEY, TEST_KEY] } },
    });
    await this.audit(actor, "claude.credential.removed", {});
    return this.account();
  }

  async test(actor: string): Promise<ClaudeTestResult> {
    const resolved = await this.resolve();
    const model = await this.testModel();
    const started = Date.now();
    let result: ClaudeTestResult;
    if (resolved.credentials.kind === "none") {
      result = {
        ok: false,
        message: "No Claude credential: sign in or paste a token first",
        model: null,
        durationMs: 0,
        at: new Date().toISOString(),
      };
    } else {
      const outcome = await this.runTest(model, credentialEnv(resolved.credentials));
      result = {
        ok: outcome.ok,
        message: outcome.message,
        model,
        durationMs: Date.now() - started,
        at: new Date().toISOString(),
      };
    }
    await this.deps.prisma.appSetting.upsert({
      where: { key: TEST_KEY },
      create: { key: TEST_KEY, value: result },
      update: { value: result },
    });
    await this.audit(actor, "claude.credential.tested", { ok: result.ok });
    return result;
  }

  startLogin(actor: string): ClaudeLoginDto {
    this.assertNotFromEnv();
    if (this.login?.state === "running") return this.toLoginDto(this.login);
    const id = randomUUID();
    const session: LoginSession = {
      id,
      pty: new PtySession(
        {
          command: this.deps.binary.command,
          args: [...this.deps.binary.args, "setup-token"],
          cwd: homedir(),
          env: this.passthroughEnv(),
          cols: LOGIN_COLS,
          rows: LOGIN_ROWS,
        },
        {
          onData: (data) => this.handleLoginOutput(session, data),
          onExit: (exit) => {
            session.exitCode = exit.exitCode;
            setTimeout(() => {
              void session.processed.then(() => {
                if (session.state === "running") session.state = "failed";
              });
            }, EXIT_SETTLE_MS);
          },
        },
        {
          ...(this.deps.killGraceMs === undefined ? {} : { killGraceMs: this.deps.killGraceMs }),
          ...(this.deps.sourceEnv ? { sourceEnv: this.deps.sourceEnv } : {}),
        },
      ),
      output: new TextTail(LOGIN_OUTPUT_CHARS),
      screen: new ScreenBuffer(LOGIN_COLS, LOGIN_ROWS),
      signInUrl: null,
      error: null,
      codeSubmittedAt: null,
      screenText: "",
      processed: Promise.resolve(),
      state: "running",
      exitCode: null,
      startedAt: new Date(),
      actor,
    };
    const previous = this.login;
    this.login = session;
    if (previous?.state === "running") void previous.pty.stop();
    session.pty.start();
    void this.audit(actor, "claude.login.started", {});
    return this.toLoginDto(session);
  }

  ownsPty(id: string): boolean {
    return this.login?.id === id;
  }

  async submitLoginCode(code: string): Promise<ClaudeAccountDto> {
    const login = this.login;
    if (!login) throw notFound("Sign-in");
    if (login.state !== "running") throw conflict("The sign-in has finished: start it again");
    const paste = login.screen.bracketedPaste() ? `${PASTE_START}${code}${PASTE_END}` : code;
    login.pty.write(paste);
    login.error = null;
    login.codeSubmittedAt = new Date();
    await new Promise((resolve) => setTimeout(resolve, SUBMIT_DELAY_MS));
    if (login.state === "running") login.pty.write("\r");
    return this.account();
  }

  async retryLogin(): Promise<ClaudeAccountDto> {
    const login = this.login;
    if (!login) throw notFound("Sign-in");
    if (login.state !== "running") throw conflict("The sign-in has finished: start it again");
    login.error = null;
    login.codeSubmittedAt = null;
    login.pty.write("\r");
    return this.account();
  }

  isSimulator(): boolean {
    const parts = [this.deps.binary.command, ...this.deps.binary.args, this.deps.config.claudeBin];
    return (
      (this.deps.cliVersion() ?? "").includes("stub") ||
      parts.some((part) => /claude-stub/.test(part))
    );
  }

  loginInput(id: string, data: string): void {
    const login = this.login;
    if (!login || login.id !== id) throw notFound("Sign-in");
    if (login.state !== "running") throw conflict("The sign-in has finished");
    login.pty.write(data);
  }

  async cancelLogin(): Promise<ClaudeAccountDto> {
    const login = this.login;
    if (login?.state === "running") {
      login.state = "cancelled";
      await login.pty.stop();
    }
    return this.account();
  }

  async shutdown(): Promise<void> {
    if (this.login?.state === "running") await this.login.pty.stop();
  }

  private handleLoginOutput(session: LoginSession, data: string): void {
    session.output.append(data);
    this.deps.hub.publishPtyOutput(session.id, data);
    session.processed = session.processed
      .then(() => session.screen.write(data))
      .then(() => this.inspectLogin(session));
  }

  private inspectLogin(session: LoginSession): void {
    const lines = session.screen.lines();
    const text = lines.join("\n");
    session.screenText = lines.slice(-SCREEN_LINES).join("\n");
    session.signInUrl =
      findSignInUrl(session.screen.links().join("\n")) ??
      findSignInUrl(session.screen.linkText()) ??
      session.signInUrl;
    session.error = findLoginError(lines);
    if (session.error !== null) session.codeSubmittedAt = null;
    if (session.state !== "running") return;
    const token = findClaudeToken(text.replace(/\s+/g, " "));
    if (!token) return;
    session.state = "connected";
    this.save(token, session.actor)
      .then(() => this.deps.logger.info("Claude subscription token saved from sign-in"))
      .catch((error: unknown) => {
        session.state = "failed";
        this.deps.logger.error({ err: error }, "Could not save the Claude token");
      });
  }

  private runTest(
    model: string,
    credentials: Record<string, string>,
  ): Promise<{ ok: boolean; message: string }> {
    return mkdtemp(join(tmpdir(), "onyx-claude-test-")).then(
      (cwd) =>
        new Promise<{ ok: boolean; message: string }>((resolve) => {
          const child = spawn(
            this.deps.binary.command,
            [
              ...this.deps.binary.args,
              "-p",
              "--output-format",
              "json",
              "--max-turns",
              "1",
              "--model",
              model,
              "--no-session-persistence",
              TEST_PROMPT,
            ],
            {
              cwd,
              env: buildChildEnv(this.deps.sourceEnv ?? process.env, DEFAULT_ENV_ALLOWLIST, {
                ...this.passthroughEnv(),
                ...credentials,
              }),
              stdio: ["ignore", "pipe", "pipe"],
            },
          );
          let stdout = "";
          const stderr = new TextTail(2_000);
          const timer = setTimeout(
            () => child.kill("SIGKILL"),
            this.deps.testTimeoutMs ?? DEFAULT_TEST_TIMEOUT_MS,
          );
          child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
            stdout += chunk;
          });
          child.stderr.setEncoding("utf8").on("data", (chunk: string) => stderr.append(chunk));
          const finish = (outcome: { ok: boolean; message: string }) => {
            clearTimeout(timer);
            void rm(cwd, { recursive: true, force: true });
            resolve(outcome);
          };
          child.on("error", (error) =>
            finish({ ok: false, message: `Claude Code could not start: ${error.message}` }),
          );
          child.on("close", (code) => {
            const parsed = parseCliResult(stdout);
            if (parsed) {
              finish({
                ok: !parsed.isError,
                message: parsed.text.trim().slice(0, 300) || (parsed.isError ? "Error" : "OK"),
              });
              return;
            }
            finish({
              ok: false,
              message:
                stderr.toString().trim().split("\n").slice(-2).join(" ").slice(0, 300) ||
                `Claude Code exited with code ${code ?? "?"}`,
            });
          });
        }),
    );
  }

  private async testModel(): Promise<string> {
    const scout = await this.deps.prisma.modelProfile.findFirst({
      where: { tier: "SCOUT", enabled: true },
      orderBy: { id: "asc" },
    });
    return scout?.id ?? "claude-haiku-4-5";
  }

  private async stored(): Promise<z.infer<typeof StoredCredentialSchema> | null> {
    const row = await this.deps.prisma.appSetting.findUnique({ where: { key: CREDENTIAL_KEY } });
    const parsed = StoredCredentialSchema.safeParse(row?.value);
    return parsed.success ? parsed.data : null;
  }

  private assertNotFromEnv(): void {
    if (this.deps.config.credentials.kind !== "none") {
      throw conflict(
        "Claude credentials come from the environment (ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN): remove them from onyx.env to manage the account here",
      );
    }
  }

  private passthroughEnv(): Record<string, string> {
    const source = this.deps.sourceEnv ?? process.env;
    const env: Record<string, string> = {};
    for (const name of this.deps.config.childEnvPassthrough) {
      const value = source[name];
      if (value !== undefined) env[name] = value;
    }
    return env;
  }

  private toLoginDto(login: LoginSession): ClaudeLoginDto {
    return {
      id: login.id,
      state: login.state,
      exitCode: login.exitCode,
      startedAt: login.startedAt.toISOString(),
      signInUrl: login.signInUrl,
      error: login.error,
      codeSubmittedAt: login.codeSubmittedAt?.toISOString() ?? null,
      screen: login.screenText,
    };
  }

  private async audit(
    actor: string,
    action: string,
    meta: Record<string, string | boolean>,
  ): Promise<void> {
    await this.deps.prisma.auditLog
      .create({ data: { actor, action, target: null, meta } })
      .catch((error: unknown) => this.deps.logger.warn({ err: error }, "Audit write failed"));
  }
}
