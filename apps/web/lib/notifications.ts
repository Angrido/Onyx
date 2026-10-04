import type { NotificationEvent } from "@onyx/contracts";

export const EVENT_LABELS: Record<NotificationEvent, { label: string; hint: string }> = {
  RUN_FAILED: { label: "A run fails", hint: "failed, timed out or interrupted" },
  RUN_BLOCKED: { label: "A run waits for you", hint: "commands to allow before it continues" },
  APPROVAL: { label: "An approval is needed", hint: "plans, merges and other decisions" },
  BUDGET: { label: "A budget is reached", hint: "runs stopped or waiting for approval" },
  QUOTA: { label: "Claude limits change", hint: "getting close, held, reached and reset" },
  RUN_FINISHED: { label: "A run finishes", hint: "every successful run" },
};

export const EVENT_ORDER: NotificationEvent[] = [
  "RUN_FAILED",
  "RUN_BLOCKED",
  "APPROVAL",
  "BUDGET",
  "QUOTA",
  "RUN_FINISHED",
];

export type PushSupport =
  { ok: true } | { ok: false; reason: "insecure" | "unsupported" | "denied" };

export function pushSupport(environment: {
  isSecureContext: boolean;
  hasServiceWorker: boolean;
  hasPushManager: boolean;
  permission: string | null;
}): PushSupport {
  if (!environment.isSecureContext) return { ok: false, reason: "insecure" };
  if (!environment.hasServiceWorker || !environment.hasPushManager)
    return { ok: false, reason: "unsupported" };
  if (environment.permission === "denied") return { ok: false, reason: "denied" };
  return { ok: true };
}

export const PUSH_SUPPORT_TEXT: Record<"insecure" | "unsupported" | "denied", string> = {
  insecure:
    "Browsers allow push notifications only on HTTPS. Open Onyx through Caddy with its internal certificate (see the operations guide), then enable them here.",
  unsupported: "This browser does not support push notifications.",
  denied: "Notifications are blocked for Onyx in this browser's site settings.",
};

export function applicationServerKey(base64url: string): Uint8Array<ArrayBuffer> {
  const padded = `${base64url}${"=".repeat((4 - (base64url.length % 4)) % 4)}`
    .replaceAll("-", "+")
    .replaceAll("_", "/");
  const binary = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}
