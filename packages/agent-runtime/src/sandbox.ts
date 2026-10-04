import { execFile } from "node:child_process";
import { signalProcessGroup } from "./process-tools";

export interface AgentSandbox {
  user: string;
  home: string;
  sudo: string;
}

export interface SandboxedCommand {
  command: string;
  args: string[];
  env: Record<string, string>;
}

export const SANDBOX_PATH_VARIABLE = "ONYX_AGENT_PATH";
const FALLBACK_PATH = "/usr/local/bin:/usr/bin:/bin";
const LAUNCHER = `umask 007; PATH="$${SANDBOX_PATH_VARIABLE}"; export PATH; unset ${SANDBOX_PATH_VARIABLE}; exec "$@"`;

function gitConfigEntries(env: Readonly<Record<string, string>>): Record<string, string> {
  const count = Number.parseInt(env["GIT_CONFIG_COUNT"] ?? "0", 10);
  const index = Number.isInteger(count) && count > 0 ? count : 0;
  return {
    GIT_CONFIG_COUNT: String(index + 1),
    [`GIT_CONFIG_KEY_${index}`]: "safe.directory",
    [`GIT_CONFIG_VALUE_${index}`]: "*",
  };
}

export function sandboxCommand(
  sandbox: AgentSandbox | null | undefined,
  command: string,
  args: readonly string[],
  env: Readonly<Record<string, string>>,
): SandboxedCommand {
  if (!sandbox) return { command, args: [...args], env: { ...env } };
  return {
    command: sandbox.sudo,
    args: [
      "-n",
      "-E",
      "-u",
      sandbox.user,
      "--",
      "/bin/sh",
      "-c",
      LAUNCHER,
      "onyx-agent",
      command,
      ...args,
    ],
    env: {
      ...env,
      HOME: sandbox.home,
      USER: sandbox.user,
      LOGNAME: sandbox.user,
      [SANDBOX_PATH_VARIABLE]: env["PATH"] ?? FALLBACK_PATH,
      ...gitConfigEntries(env),
    },
  };
}

function runAsAgent(sandbox: AgentSandbox, script: string): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(
      sandbox.sudo,
      ["-n", "-u", sandbox.user, "--", "/bin/sh", "-c", script],
      { timeout: 5_000 },
      (error) => resolve(error === null),
    );
  });
}

export async function signalSandboxedGroup(
  sandbox: AgentSandbox | null | undefined,
  pgid: number,
  signal: NodeJS.Signals,
): Promise<void> {
  if (sandbox) await runAsAgent(sandbox, `kill -s ${signal.replace(/^SIG/, "")} -- -${pgid}`);
  try {
    signalProcessGroup(pgid, signal);
  } catch {
    return;
  }
}
