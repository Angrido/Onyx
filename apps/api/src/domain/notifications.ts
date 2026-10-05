import type { NotificationEvent, NotificationEvents, QuotaLevel, RunStatus } from "@onyx/contracts";
import { msg, tx } from "../i18n";

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

const RUN_ENDED: Record<"FAILED" | "TIMEOUT" | "INTERRUPTED", string> = {
  FAILED: msg("Run failed · {task}"),
  TIMEOUT: msg("Run timeout · {task}"),
  INTERRUPTED: msg("Run interrupted · {task}"),
};

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
  const blocked = {
    project: input.projectName,
    task: input.taskTitle,
    count: input.blockedCommands,
  };
  if (input.blockedCommands > 0)
    return {
      event: "RUN_BLOCKED",
      title: clip(tx("Waiting for you · {task}", { task: input.taskTitle }), MAX_TITLE),
      body: clip(
        input.blockedCommands === 1
          ? tx(
              "{project}: {task}. The agent was not allowed to run {count} command: allow them to continue.",
              blocked,
            )
          : tx(
              "{project}: {task}. The agent was not allowed to run {count} commands: allow them to continue.",
              blocked,
            ),
        MAX_BODY,
      ),
      path: `/runs/${input.runId}`,
      tag: `run-${input.runId}`,
      urgent: true,
    };
  if (input.status === "COMPLETED")
    return {
      event: "RUN_FINISHED",
      title: clip(tx("Done · {task}", { task: input.taskTitle }), MAX_TITLE),
      body: clip(`${where}${money(input.costUsd)}`, MAX_BODY),
      path: `/runs/${input.runId}`,
      tag: `run-${input.runId}`,
      urgent: false,
    };
  if (input.status === "FAILED" || input.status === "TIMEOUT" || input.status === "INTERRUPTED")
    return {
      event: "RUN_FAILED",
      title: clip(tx(RUN_ENDED[input.status], { task: input.taskTitle }), MAX_TITLE),
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
  const where = { project: input.projectName, number: input.number };
  return input.passed
    ? {
        event: "CHECKS",
        title: clip(tx("Checks passed · {title}", { title: input.title }), MAX_TITLE),
        body: clip(tx("{project} #{number}: every check is green.", where), MAX_BODY),
        path: `/projects/${input.projectId}/github`,
        tag: `checks-${input.projectId}-${input.number}`,
        urgent: false,
      }
    : {
        event: "CHECKS",
        title: clip(tx("Checks failed · {title}", { title: input.title }), MAX_TITLE),
        body: clip(
          input.failed.length === 0
            ? tx("{project} #{number}: a check failed.", where)
            : tx("{project} #{number}: {checks} failed.", {
                ...where,
                checks: input.failed.join(", "),
              }),
          MAX_BODY,
        ),
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
    title: clip(budget ? tx("Budget reached") : tx("Approval needed"), MAX_TITLE),
    body: clip(input.projectName ? `${input.projectName}: ${input.title}` : input.title, MAX_BODY),
    path: "/approvals",
    tag: `approval-${input.id}`,
    urgent: true,
  };
}

export function budgetMessage(projectName: string | null, reason: string): NotificationMessage {
  return {
    event: "BUDGET",
    title: tx("Runs stopped by a budget"),
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
      title: tx("Claude limits reset"),
      body: clip(message, MAX_BODY),
      path: "/telemetry#quota",
      tag: "quota",
      urgent: false,
    };
  }
  const titles: Record<QuotaLevel, string> = {
    UNKNOWN: "",
    OK: "",
    WARNING: msg("Claude limits: getting close"),
    HOLDING: msg("Claude limits: tasks that can wait are held"),
    LIMITED: msg("Claude limits reached"),
  };
  return {
    event: "QUOTA",
    title: titles[next] === "" ? "" : tx(titles[next]),
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
  if (link) lines.push(`<a href="${escapeHtml(link)}">${escapeHtml(tx("Open in Onyx"))}</a>`);
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
