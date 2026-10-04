import { DEFAULT_ENV_ALLOWLIST } from "@onyx/agent-runtime";

const GIT_ENV_EXTRAS = ["SSH_AUTH_SOCK", "XDG_CONFIG_HOME", "LC_CTYPE", "LANGUAGE"];

export const GIT_SAFETY_ARGS: readonly string[] = [
  "-c",
  "core.fsmonitor=false",
  "-c",
  "core.hooksPath=/dev/null",
];

export function gitEnvironment(
  source: NodeJS.ProcessEnv = process.env,
  extra: Readonly<Record<string, string>> = {},
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(source)) {
    if (value === undefined) continue;
    if (
      DEFAULT_ENV_ALLOWLIST.includes(name) ||
      GIT_ENV_EXTRAS.includes(name) ||
      name.startsWith("GIT_")
    )
      env[name] = value;
  }
  return { ...env, ...extra };
}

export function safeGitArgs(args: readonly string[]): string[] {
  return [...GIT_SAFETY_ARGS, ...args];
}
