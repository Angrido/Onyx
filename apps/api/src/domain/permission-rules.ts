export const SECRET_READ_DENY_RULES: readonly string[] = [
  "Read(**/.env)",
  "Read(**/.env.*)",
  "Read(**/*.pem)",
  "Read(**/*.key)",
  "Read(**/*.p12)",
  "Read(**/id_rsa*)",
  "Read(**/id_ed25519*)",
];

export const RUN_TOKEN_ENV = "ONYX_RUN_TOKEN";
export const GUARDED_TOOLS = "Read|Grep|Glob|LS|LSP|NotebookRead|Bash";
export const EDIT_TOOLS = "Edit|Write|MultiEdit|NotebookEdit";
export const HOOK_TIMEOUT_SECONDS = 10;

export interface HttpHook {
  type: "http";
  url: string;
  headers: Record<string, string>;
  allowedEnvVars: string[];
  timeout: number;
}

export interface HookMatcher {
  matcher: string;
  hooks: HttpHook[];
}

export interface RunHooks {
  PreToolUse: HookMatcher[];
  PostToolUse: HookMatcher[];
  SessionStart?: HookMatcher[];
  UserPromptSubmit?: HookMatcher[];
}

export interface StatusLineSetting {
  type: "command";
  command: string;
  padding: number;
}

export interface RunSettings {
  permissions: {
    deny: string[];
    allow: string[];
  };
  hooks?: RunHooks;
  statusLine?: StatusLineSetting;
}

export interface RunSettingsOptions {
  deny?: readonly string[];
  hooks?: RunHooks;
  statusLine?: StatusLineSetting;
}

function httpHook(url: string): HttpHook {
  return {
    type: "http",
    url,
    headers: { Authorization: `Bearer $${RUN_TOKEN_ENV}` },
    allowedEnvVars: [RUN_TOKEN_ENV],
    timeout: HOOK_TIMEOUT_SECONDS,
  };
}

export function guardHooks(internalApiUrl: string): RunHooks {
  return {
    PreToolUse: [
      {
        matcher: `${GUARDED_TOOLS}|${EDIT_TOOLS}`,
        hooks: [httpHook(`${internalApiUrl}/internal/hooks/pre-tool-use`)],
      },
    ],
    PostToolUse: [
      { matcher: EDIT_TOOLS, hooks: [httpHook(`${internalApiUrl}/internal/hooks/post-tool-use`)] },
    ],
  };
}

export const SESSION_START_SOURCES = "startup|resume|clear|compact";

export function terminalHooks(internalApiUrl: string): RunHooks {
  return {
    ...guardHooks(internalApiUrl),
    SessionStart: [
      {
        matcher: SESSION_START_SOURCES,
        hooks: [httpHook(`${internalApiUrl}/internal/hooks/session-start`)],
      },
    ],
    UserPromptSubmit: [
      { matcher: "", hooks: [httpHook(`${internalApiUrl}/internal/hooks/user-prompt-submit`)] },
    ],
  };
}

function shellQuote(value: string): string {
  return `'${value.split("'").join(`'\\''`)}'`;
}

export function statusLineSetting(nodePath: string, scriptPath: string): StatusLineSetting {
  return {
    type: "command",
    command: `${shellQuote(nodePath)} ${shellQuote(scriptPath)}`,
    padding: 0,
  };
}

export function buildRunSettings(options: RunSettingsOptions = {}): RunSettings {
  return {
    permissions: {
      deny: [...new Set([...SECRET_READ_DENY_RULES, ...(options.deny ?? [])])],
      allow: [],
    },
    ...(options.hooks ? { hooks: options.hooks } : {}),
    ...(options.statusLine ? { statusLine: options.statusLine } : {}),
  };
}
