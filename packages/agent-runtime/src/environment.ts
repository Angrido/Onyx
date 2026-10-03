export const DEFAULT_ENV_ALLOWLIST: readonly string[] = [
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "LANG",
  "LC_ALL",
  "TZ",
  "TERM",
  "TMPDIR",
  "HTTPS_PROXY",
  "HTTP_PROXY",
  "NO_PROXY",
  "https_proxy",
  "http_proxy",
  "no_proxy",
  "NODE_EXTRA_CA_CERTS",
  "SSL_CERT_FILE",
];

export const HEADLESS_ENV_DEFAULTS: Readonly<Record<string, string>> = {
  DISABLE_AUTOUPDATER: "1",
};

export function buildChildEnv(
  source: NodeJS.ProcessEnv,
  allowlist: readonly string[],
  extra: Readonly<Record<string, string>>,
): Record<string, string> {
  const env: Record<string, string> = { ...HEADLESS_ENV_DEFAULTS };
  for (const key of allowlist) {
    const value = source[key];
    if (value !== undefined) env[key] = value;
  }
  for (const [key, value] of Object.entries(extra)) {
    if (value.length > 0) env[key] = value;
  }
  return env;
}
