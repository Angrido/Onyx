import { spawn } from "node:child_process";
import { TextTail } from "@onyx/agent-runtime";
import { gitEnvironment, safeGitArgs } from "./git-env";

export interface CloneProgress {
  phase: string;
  percent: number | null;
}

export interface CloneOptions {
  url: string;
  destination: string;
  branch: string | null;
  token: string | null;
  tokenOrigin: string | null;
  gitBin?: string;
  timeoutMs?: number;
  sourceEnv?: NodeJS.ProcessEnv;
  onProgress?: (progress: CloneProgress) => void;
}

const PROGRESS_LINE = /^(?:remote:\s*)?([A-Za-z][A-Za-z ]*?):\s+(\d{1,3})%/;
const DEFAULT_TIMEOUT_MS = 30 * 60_000;
const KILL_GRACE_MS = 3_000;

export function parseGitProgress(line: string): CloneProgress | null {
  const match = PROGRESS_LINE.exec(line.trim());
  if (!match?.[1] || match[2] === undefined) return null;
  return { phase: match[1], percent: Math.min(100, Number(match[2])) };
}

export function basicAuthHeader(token: string): string {
  return `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`;
}

export function redact(text: string, secrets: readonly string[]): string {
  return secrets
    .filter((secret) => secret.length > 0)
    .reduce((current, secret) => current.split(secret).join("***"), text);
}

export function credentialEnv(token: string | null, origin: string | null): Record<string, string> {
  const entries: Array<[string, string]> = [
    ["credential.helper", ""],
    ["core.askPass", ""],
  ];
  if (token !== null && origin !== null)
    entries.push([`http.${origin}/.extraheader`, basicAuthHeader(token)]);
  const env: Record<string, string> = { GIT_CONFIG_COUNT: String(entries.length) };
  entries.forEach(([key, value], index) => {
    env[`GIT_CONFIG_KEY_${index}`] = key;
    env[`GIT_CONFIG_VALUE_${index}`] = value;
  });
  return env;
}

function failureMessage(stderr: string, secrets: readonly string[]): string {
  const lines = redact(stderr, secrets)
    .split(/[\r\n]+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && parseGitProgress(line) === null);
  const meaningful = lines.filter((line) =>
    /^(fatal|error|remote: (?!Enumerating|Counting|Compressing|Total))/i.test(line),
  );
  return (meaningful.length > 0 ? meaningful : lines).slice(-3).join(" · ") || "git clone failed";
}

export function cloneRepository(options: CloneOptions): Promise<void> {
  const secrets = options.token
    ? [options.token, basicAuthHeader(options.token).slice("AUTHORIZATION: basic ".length)]
    : [];
  const args = [
    "clone",
    "--progress",
    ...(options.branch ? ["--branch", options.branch] : []),
    "--",
    options.url,
    options.destination,
  ];
  return new Promise((resolve, reject) => {
    const child = spawn(options.gitBin ?? "git", safeGitArgs(args), {
      env: gitEnvironment(options.sourceEnv ?? process.env, {
        GIT_TERMINAL_PROMPT: "0",
        GCM_INTERACTIVE: "never",
        ...credentialEnv(options.token, options.tokenOrigin),
      }),
      stdio: ["ignore", "ignore", "pipe"],
    });
    const stderr = new TextTail(16_000);
    let pending = "";
    let settled = false;
    const finish = (error: Error | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve();
    };
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), KILL_GRACE_MS).unref();
      finish(new Error("git clone timed out"));
    }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    timer.unref();

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr.append(chunk);
      const parts = `${pending}${chunk}`.split(/[\r\n]/);
      pending = parts.pop() ?? "";
      for (const part of parts) {
        const progress = parseGitProgress(part);
        if (progress) options.onProgress?.(progress);
      }
    });
    child.on("error", (error) =>
      finish(new Error(`git could not start: ${redact(error.message, secrets)}`)),
    );
    child.on("close", (code) => {
      if (code === 0) finish(null);
      else finish(new Error(failureMessage(stderr.toString(), secrets)));
    });
  });
}
