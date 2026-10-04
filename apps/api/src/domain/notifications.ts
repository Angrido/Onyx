import type { NotificationEvent, NotificationEvents, QuotaLevel, RunStatus } from "@onyx/contracts";

export interface NotificationMessage {
  event: NotificationEvent;
  title: string;
  body: string;
  path: string;
  tag: string;
  urgent: boolean;
}

export const DEFAULT_NOTIFICATION_EVENTS: NotificationEvents = {
  RUN_FINISHED: false,
  RUN_FAILED: true,
  RUN_BLOCKED: true,
  APPROVAL: true,
  BUDGET: true,
  QUOTA: true,
  CHECKS: true,
};

const MAX_TITLE = 120;
const MAX_BODY = 600;

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function money(value: number | null): string {
  return value === null ? "" : ` · $${value.toFixed(2)}`;
}

export function runMessage(input: {
  runId: string;
  taskTitle: string;
  projectName: string;
  status: RunStatus;
  costUsd: number | null;
  blockedCommands: number;
}): NotificationMessage | null {
  const where = `${input.projectName}: ${input.taskTitle}`;
  if (input.blockedCommands > 0)
    return {
      event: "RUN_BLOCKED",
      title: clip(`Waiting for you · ${input.taskTitle}`, MAX_TITLE),
      body: clip(
        `${where}. The agent was not allowed to run ${input.blockedCommands} ${input.blockedCommands === 1 ? "command" : "commands"}: allow them to continue.`,
        MAX_BODY,
      ),
      path: `/runs/${input.runId}`,
      tag: `run-${input.runId}`,
      urgent: true,
    };
  if (input.status === "COMPLETED")
    return {
      event: "RUN_FINISHED",
      title: clip(`Done · ${input.taskTitle}`, MAX_TITLE),
      body: clip(`${where}${money(input.costUsd)}`, MAX_BODY),
      path: `/runs/${input.runId}`,
      tag: `run-${input.runId}`,
      urgent: false,
    };
  if (input.status === "FAILED" || input.status === "TIMEOUT" || input.status === "INTERRUPTED")
    return {
      event: "RUN_FAILED",
      title: clip(`Run ${input.status.toLowerCase()} · ${input.taskTitle}`, MAX_TITLE),
      body: clip(`${where}${money(input.costUsd)}`, MAX_BODY),
      path: `/runs/${input.runId}`,
      tag: `run-${input.runId}`,
      urgent: true,
    };
  return null;
}

export function checksMessage(input: {
  projectId: string;
  projectName: string;
  number: number;
  title: string;
  passed: boolean;
  failed: readonly string[];
}): NotificationMessage {
  const where = `${input.projectName} #${input.number}`;
  return input.passed
    ? {
        event: "CHECKS",
        title: clip(`Checks passed · ${input.title}`, MAX_TITLE),
        body: clip(`${where}: every check is green.`, MAX_BODY),
        path: `/projects/${input.projectId}/github`,
        tag: `checks-${input.projectId}-${input.number}`,
        urgent: false,
      }
    : {
        event: "CHECKS",
        title: clip(`Checks failed · ${input.title}`, MAX_TITLE),
        body: clip(`${where}: ${input.failed.join(", ") || "a check"} failed.`, MAX_BODY),
        path: `/projects/${input.projectId}/github`,
        tag: `checks-${input.projectId}-${input.number}`,
        urgent: true,
      };
}

export function approvalMessage(input: {
  id: string;
  kind: string;
  title: string;
  projectName: string | null;
}): NotificationMessage {
  const budget = input.kind === "BUDGET";
  return {
    event: budget ? "BUDGET" : "APPROVAL",
    title: clip(budget ? "Budget reached" : "Approval needed", MAX_TITLE),
    body: clip(input.projectName ? `${input.projectName}: ${input.title}` : input.title, MAX_BODY),
    path: "/approvals",
    tag: `approval-${input.id}`,
    urgent: true,
  };
}

export function budgetMessage(projectName: string | null, reason: string): NotificationMessage {
  return {
    event: "BUDGET",
    title: "Runs stopped by a budget",
    body: clip(projectName ? `${projectName}: ${reason}` : reason, MAX_BODY),
    path: "/settings",
    tag: `budget-${projectName ?? "all"}`,
    urgent: true,
  };
}

const QUOTA_RANK: Record<QuotaLevel, number> = {
  UNKNOWN: 0,
  OK: 0,
  WARNING: 1,
  HOLDING: 2,
  LIMITED: 3,
};

export function quotaNotice(
  previous: QuotaLevel,
  next: QuotaLevel,
  message: string,
): NotificationMessage | null {
  if (QUOTA_RANK[next] <= QUOTA_RANK[previous]) {
    if (QUOTA_RANK[previous] < 2 || QUOTA_RANK[next] > 0) return null;
    return {
      event: "QUOTA",
      title: "Claude limits reset",
      body: clip(message, MAX_BODY),
      path: "/telemetry#quota",
      tag: "quota",
      urgent: false,
    };
  }
  const titles: Record<QuotaLevel, string> = {
    UNKNOWN: "",
    OK: "",
    WARNING: "Claude limits: getting close",
    HOLDING: "Claude limits: tasks that can wait are held",
    LIMITED: "Claude limits reached",
  };
  return {
    event: "QUOTA",
    title: titles[next],
    body: clip(message, MAX_BODY),
    path: "/telemetry#quota",
    tag: "quota",
    urgent: next === "LIMITED",
  };
}

export function linkFor(base: string | null, path: string): string | null {
  if (!base) return null;
  return new URL(path, base.endsWith("/") ? base : `${base}/`).toString();
}

export function ntfyRequest(
  settings: { server: string; topic: string; token: string | null },
  message: NotificationMessage,
  base: string | null,
): { url: string; headers: Record<string, string>; body: string } {
  const link = linkFor(base, message.path);
  const headers: Record<string, string> = {
    Title: encodeHeader(message.title),
    Priority: message.urgent ? "high" : "default",
    Tags: message.urgent ? "warning" : "white_check_mark",
  };
  if (link) headers["Click"] = link;
  if (settings.token) headers["Authorization"] = `Bearer ${settings.token}`;
  const server = settings.server.endsWith("/") ? settings.server : `${settings.server}/`;
  return { url: new URL(settings.topic, server).toString(), headers, body: message.body };
}

function encodeHeader(value: string): string {
  return /^[\x20-\x7e]*$/.test(value)
    ? value
    : `=?UTF-8?B?${Buffer.from(value).toString("base64")}?=`;
}

function escapeHtml(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export function telegramRequest(
  settings: { apiUrl: string; token: string; chatId: string },
  message: NotificationMessage,
  base: string | null,
): { url: string; body: Record<string, unknown> } {
  const link = linkFor(base, message.path);
  const lines = [`<b>${escapeHtml(message.title)}</b>`, escapeHtml(message.body)];
  if (link) lines.push(`<a href="${escapeHtml(link)}">Open in Onyx</a>`);
  return {
    url: `${settings.apiUrl.replace(/\/$/, "")}/bot${settings.token}/sendMessage`,
    body: {
      chat_id: settings.chatId,
      text: lines.join("\n"),
      parse_mode: "HTML",
      disable_web_page_preview: true,
      disable_notification: !message.urgent,
    },
  };
}

export function pushPayload(message: NotificationMessage): string {
  return JSON.stringify({
    title: message.title,
    body: message.body,
    url: message.path,
    tag: message.tag,
  });
}
