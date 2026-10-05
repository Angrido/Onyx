export const REDACTED = "[redacted]";

const MAX_DEPTH = 10;

const SENSITIVE_KEY =
  /passw(?:or)?d|passphrase|^pass$|secret|token|authori[sz]ation|cookie|api[-_]?key|private[-_]?key|vapid|credential|signature|^sid$|_sid$|^auth$|^p256dh$|^dsn$/i;

const NOT_SENSITIVE_KEY = /tokens$|^tokens?(?:count|total|usage|budget|limit)s?$|tokenizer$/i;

const TEXT_RULES: readonly { pattern: RegExp; replace: string }[] = [
  {
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
    replace: REDACTED,
  },
  { pattern: /\bsk-ant-[A-Za-z0-9_-]{4,}/g, replace: REDACTED },
  { pattern: /\bsk-[A-Za-z0-9_-]{20,}/g, replace: REDACTED },
  { pattern: /\bgithub_pat_[A-Za-z0-9_]{10,}/g, replace: REDACTED },
  { pattern: /\bgh[pousr]_[A-Za-z0-9]{10,}/g, replace: REDACTED },
  { pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/g, replace: REDACTED },
  { pattern: /\b(bot)?\d{6,12}:[A-Za-z0-9_-]{30,}/g, replace: `$1${REDACTED}` },
  { pattern: /\b(Bearer)(\s+)[A-Za-z0-9._~+/=:-]{6,}/gi, replace: `$1$2${REDACTED}` },
  {
    pattern: /\b(Basic)(\s+)(?=[A-Za-z0-9+/]*[0-9+/=])[A-Za-z0-9+/]{8,}={0,2}/g,
    replace: `$1$2${REDACTED}`,
  },
  { pattern: /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/?#@"'<>\\]+@/gi, replace: `$1${REDACTED}@` },
  {
    pattern:
      /([?&;](?:access_token|refresh_token|id_token|token|key|api_key|apikey|secret|password|passwd|auth|code|sig|signature|client_secret)=)[^&\s"'#\\]+/gi,
    replace: `$1${REDACTED}`,
  },
  {
    pattern:
      /\b([A-Za-z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIALS?|COOKIE)[A-Za-z0-9_]*)(\s*[=:]\s*)(?!\[redacted\])("[^"\\]*"|'[^'\\]*'|[^\s"',;&\\]+)/g,
    replace: `$1$2${REDACTED}`,
  },
  {
    pattern:
      /("(?:password|passwd|secret|token|access_token|refresh_token|authorization|cookie|api_?key|private_?key|vapid_?private_?key|client_secret)"\s*:\s*)"(?:[^"\\]|\\.)*"/gi,
    replace: `$1"${REDACTED}"`,
  },
  {
    pattern: /\b((?:set-)?cookie|authorization|x-api-key)(\s*[:=]\s*)[^\n"\\]+/gi,
    replace: `$1$2${REDACTED}`,
  },
  { pattern: /\b(onyx_sid)=[^;\s"'\\]+/g, replace: `$1=${REDACTED}` },
];

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY.test(key) && !NOT_SENSITIVE_KEY.test(key);
}

export function redactText(text: string): string {
  let result = text;
  for (const rule of TEXT_RULES) result = result.replace(rule.pattern, rule.replace);
  return result;
}

function redactWithin(value: unknown, sensitive: boolean, depth: number): unknown {
  if (typeof value === "string") return sensitive ? REDACTED : redactText(value);
  if (value === null || typeof value !== "object") return value;
  if (value instanceof Date) return value;
  if (depth >= MAX_DEPTH) return REDACTED;
  if (Array.isArray(value)) return value.map((entry) => redactWithin(entry, sensitive, depth + 1));
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>))
    result[redactText(key)] = redactWithin(entry, sensitive || isSensitiveKey(key), depth + 1);
  return result;
}

export function redactValue<T>(value: T): T {
  return redactWithin(value, false, 0) as T;
}
