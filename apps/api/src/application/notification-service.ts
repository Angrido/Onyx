import {
  NotificationEventsSchema,
  type NotificationChannel,
  type NotificationSettingsDto,
  type PushSubscriptionRequestSchema,
  type QuotaLevel,
  type RunStatus,
  type TestNotificationResponse,
  type UpdateNotificationSettingsRequestSchema,
} from "@onyx/contracts";
import type { Prisma, PrismaClient } from "@onyx/db";
import type { Logger } from "pino";
import { z } from "zod";
import {
  DEFAULT_NOTIFICATION_EVENTS,
  approvalMessage,
  budgetMessage,
  ntfyRequest,
  pushPayload,
  quotaNotice,
  runMessage,
  telegramRequest,
  type NotificationMessage,
} from "../domain/notifications";
import { badRequest } from "../errors";
import { msg, tx } from "../i18n";
import type { SecretVault } from "../infrastructure/secret-vault";
import { generateVapidKeys, sendWebPush, type VapidKeys } from "../infrastructure/web-push";

type UpdateInput = z.output<typeof UpdateNotificationSettingsRequestSchema>;
type SubscriptionInput = z.output<typeof PushSubscriptionRequestSchema>;

export const NOTIFICATION_SETTINGS_KEY = "notifications.settings";
export const VAPID_KEY = "notifications.vapid";
const SECRET_PURPOSE = "notifications.secret";
const PUSH_PURPOSE = "notifications.push";
const REPEAT_WINDOW_MS = 60_000;
const SEND_TIMEOUT_MS = 10_000;
const MAX_FAILURES = 5;
const PUSH_SUBJECT = "mailto:onyx@localhost";

const StoredSchema = z.object({
  events: NotificationEventsSchema.catch(DEFAULT_NOTIFICATION_EVENTS),
  webPush: z.object({ enabled: z.boolean() }).catch({ enabled: false }),
  ntfy: z
    .object({
      enabled: z.boolean(),
      server: z.string(),
      topic: z.string(),
      token: z.string().nullable(),
    })
    .catch({ enabled: false, server: "", topic: "", token: null }),
  telegram: z
    .object({ enabled: z.boolean(), chatId: z.string(), token: z.string().nullable() })
    .catch({ enabled: false, chatId: "", token: null }),
});
type Stored = z.infer<typeof StoredSchema>;

const StoredVapidSchema = z.object({ publicKey: z.string(), privateKey: z.string() });
const PushKeysSchema = z.object({ p256dh: z.string(), auth: z.string() });

const DEFAULT_STORED: Stored = StoredSchema.parse({});

export interface NotificationServiceDeps {
  prisma: PrismaClient;
  logger: Logger;
  vault: Pick<SecretVault, "seal" | "reveal">;
  linkBase: string | null;
  fetcher?: typeof fetch;
  telegramApiUrl?: string;
  now?: () => number;
}

export class NotificationService {
  private stored: Stored = DEFAULT_STORED;
  private vapid: VapidKeys | null = null;
  private readonly recent = new Map<string, number>();
  private sending: Promise<unknown> = Promise.resolve();

  constructor(private readonly deps: NotificationServiceDeps) {}

  async load(): Promise<void> {
    const row = await this.deps.prisma.appSetting.findUnique({
      where: { key: NOTIFICATION_SETTINGS_KEY },
    });
    this.stored = row ? StoredSchema.parse(row.value) : DEFAULT_STORED;
  }

  async settings(): Promise<NotificationSettingsDto> {
    const devices = await this.deps.prisma.pushSubscription.count();
    const { events, webPush, ntfy, telegram } = this.stored;
    return {
      events,
      webPush: { enabled: webPush.enabled, devices },
      ntfy: {
        enabled: ntfy.enabled,
        server: ntfy.server,
        topic: ntfy.topic,
        hasToken: ntfy.token !== null,
      },
      telegram: {
        enabled: telegram.enabled,
        chatId: telegram.chatId,
        hasToken: telegram.token !== null,
      },
      linkBase: this.deps.linkBase,
    };
  }

  async update(input: UpdateInput): Promise<NotificationSettingsDto> {
    const next: Stored = structuredClone(this.stored);
    if (input.events) next.events = input.events;
    if (input.webPush) next.webPush = input.webPush;
    if (input.ntfy)
      next.ntfy = {
        enabled: input.ntfy.enabled,
        server: input.ntfy.server,
        topic: input.ntfy.topic,
        token: this.secret(input.ntfy.token, next.ntfy.token),
      };
    if (input.telegram)
      next.telegram = {
        enabled: input.telegram.enabled,
        chatId: input.telegram.chatId,
        token: this.secret(input.telegram.token, next.telegram.token),
      };
    if (next.telegram.enabled && (next.telegram.token === null || next.telegram.chatId === ""))
      throw badRequest("Telegram needs a bot token and a chat id");
    const value = next as unknown as Prisma.InputJsonValue;
    await this.deps.prisma.appSetting.upsert({
      where: { key: NOTIFICATION_SETTINGS_KEY },
      create: { key: NOTIFICATION_SETTINGS_KEY, value },
      update: { value },
    });
    this.stored = next;
    return this.settings();
  }

  async publicKey(): Promise<string> {
    return (await this.vapidKeys()).publicKey;
  }

  async subscribe(
    input: SubscriptionInput,
    userAgent: string | null,
  ): Promise<NotificationSettingsDto> {
    const keys = this.deps.vault.seal(JSON.stringify(input.keys), PUSH_PURPOSE);
    await this.deps.prisma.pushSubscription.upsert({
      where: { endpoint: input.endpoint },
      create: { endpoint: input.endpoint, keys, userAgent: userAgent?.slice(0, 200) ?? null },
      update: { keys, failures: 0, userAgent: userAgent?.slice(0, 200) ?? null },
    });
    if (!this.stored.webPush.enabled) return this.update({ webPush: { enabled: true } });
    return this.settings();
  }

  async unsubscribe(endpoint: string): Promise<NotificationSettingsDto> {
    await this.deps.prisma.pushSubscription.deleteMany({ where: { endpoint } });
    return this.settings();
  }

  async test(channel: NotificationChannel): Promise<TestNotificationResponse> {
    const message: NotificationMessage = {
      event: "RUN_FINISHED",
      title: tx("Onyx test notification"),
      body: tx("Notifications reach this channel."),
      path: "/settings",
      tag: `test-${channel}`,
      urgent: false,
    };
    try {
      const detail = await this.deliver(channel, message, true);
      return { ok: true, detail };
    } catch (error) {
      return { ok: false, detail: error instanceof Error ? tx(error.message) : String(error) };
    }
  }

  async runFinished(input: {
    runId: string;
    status: RunStatus;
    blockedCommands: number;
  }): Promise<void> {
    if (!this.anyChannel()) return;
    const run = await this.deps.prisma.agentRun.findUnique({
      where: { id: input.runId },
      select: {
        costUsd: true,
        task: { select: { title: true, project: { select: { name: true } } } },
      },
    });
    if (!run) return;
    const message = runMessage({
      runId: input.runId,
      taskTitle: run.task.title,
      projectName: run.task.project.name,
      status: input.status,
      costUsd: run.costUsd,
      blockedCommands: input.blockedCommands,
    });
    if (message) this.notify(message);
  }

  approvalCreated(input: { id: string; kind: string; title: string; projectName: string | null }) {
    this.notify(approvalMessage(input));
  }

  budgetStopped(projectName: string | null, reason: string): void {
    this.notify(budgetMessage(projectName, reason));
  }

  quotaChanged(previous: QuotaLevel, next: QuotaLevel, message: string): void {
    const notice = quotaNotice(previous, next, message);
    if (notice) this.notify(notice);
  }

  notify(message: NotificationMessage): void {
    if (!this.stored.events[message.event] || !this.anyChannel()) return;
    const now = this.deps.now?.() ?? Date.now();
    const key = `${message.event}:${message.tag}`;
    const last = this.recent.get(key);
    if (last !== undefined && now - last < REPEAT_WINDOW_MS) return;
    this.recent.set(key, now);
    for (const [entry, at] of this.recent)
      if (now - at >= REPEAT_WINDOW_MS) this.recent.delete(entry);
    const channels: NotificationChannel[] = [];
    if (this.stored.webPush.enabled) channels.push("webpush");
    if (this.stored.ntfy.enabled) channels.push("ntfy");
    if (this.stored.telegram.enabled) channels.push("telegram");
    const delivery = Promise.allSettled(
      channels.map((channel) =>
        this.deliver(channel, message, false).catch((error: unknown) =>
          this.deps.logger.warn(
            { err: error, channel, event: message.event },
            "Notification failed",
          ),
        ),
      ),
    );
    this.sending = Promise.allSettled([this.sending, delivery]);
  }

  async idle(): Promise<void> {
    await this.sending;
  }

  private anyChannel(): boolean {
    const { webPush, ntfy, telegram } = this.stored;
    return webPush.enabled || ntfy.enabled || telegram.enabled;
  }

  private secret(update: string | null | undefined, current: string | null): string | null {
    if (update === undefined) return current;
    if (update === null) return null;
    return this.deps.vault.seal(update, SECRET_PURPOSE);
  }

  private reveal(sealed: string | null): string | null {
    return sealed === null ? null : this.deps.vault.reveal(sealed, SECRET_PURPOSE);
  }

  private fetcher(): typeof fetch {
    return this.deps.fetcher ?? fetch;
  }

  private async deliver(
    channel: NotificationChannel,
    message: NotificationMessage,
    explicit: boolean,
  ): Promise<string> {
    if (channel === "ntfy") return this.sendNtfy(message, explicit);
    if (channel === "telegram") return this.sendTelegram(message, explicit);
    return this.sendPush(message);
  }

  private async sendNtfy(message: NotificationMessage, explicit: boolean): Promise<string> {
    const { ntfy } = this.stored;
    if (!ntfy.server || !ntfy.topic) throw new Error(msg("Enter the ntfy server and topic first"));
    if (!ntfy.enabled && !explicit) return "off";
    const request = ntfyRequest(
      { server: ntfy.server, topic: ntfy.topic, token: this.reveal(ntfy.token) },
      message,
      this.deps.linkBase,
    );
    const response = await this.fetcher()(request.url, {
      method: "POST",
      headers: request.headers,
      body: request.body,
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`ntfy answered ${response.status}`);
    return tx("Sent to {url}", { url: request.url });
  }

  private async sendTelegram(message: NotificationMessage, explicit: boolean): Promise<string> {
    const { telegram } = this.stored;
    const token = this.reveal(telegram.token);
    if (!token || !telegram.chatId) throw new Error(msg("Enter the bot token and chat id first"));
    if (!telegram.enabled && !explicit) return "off";
    const request = telegramRequest(
      {
        apiUrl: this.deps.telegramApiUrl ?? "https://api.telegram.org",
        token,
        chatId: telegram.chatId,
      },
      message,
      this.deps.linkBase,
    );
    const response = await this.fetcher()(request.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request.body),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`Telegram answered ${response.status}`);
    return tx("Sent to chat {chat}", { chat: telegram.chatId });
  }

  private async sendPush(message: NotificationMessage): Promise<string> {
    const subscriptions = await this.deps.prisma.pushSubscription.findMany();
    if (subscriptions.length === 0) throw new Error(msg("No browser is subscribed yet"));
    const keys = await this.vapidKeys();
    const payload = pushPayload(message);
    let delivered = 0;
    for (const subscription of subscriptions) {
      const opened = this.deps.vault.reveal(subscription.keys, PUSH_PURPOSE);
      const parsed = PushKeysSchema.safeParse(opened === null ? null : JSON.parse(opened));
      if (!parsed.success) {
        await this.deps.prisma.pushSubscription.delete({ where: { id: subscription.id } });
        continue;
      }
      const result = await sendWebPush(
        { endpoint: subscription.endpoint, ...parsed.data },
        payload,
        keys,
        PUSH_SUBJECT,
        this.fetcher(),
        message.urgent ? "high" : "normal",
      ).catch(() => ({ status: 0, gone: false }));
      if (result.gone || (result.status >= 400 && subscription.failures + 1 >= MAX_FAILURES)) {
        await this.deps.prisma.pushSubscription.delete({ where: { id: subscription.id } });
      } else if (result.status >= 200 && result.status < 300) {
        delivered += 1;
        await this.deps.prisma.pushSubscription.update({
          where: { id: subscription.id },
          data: { failures: 0, lastSentAt: new Date() },
        });
      } else {
        await this.deps.prisma.pushSubscription.update({
          where: { id: subscription.id },
          data: { failures: { increment: 1 } },
        });
      }
    }
    if (delivered === 0) throw new Error(msg("No browser accepted the notification"));
    return delivered === 1
      ? tx("Sent to {count} browser", { count: delivered })
      : tx("Sent to {count} browsers", { count: delivered });
  }

  private async vapidKeys(): Promise<VapidKeys> {
    if (this.vapid) return this.vapid;
    const row = await this.deps.prisma.appSetting.findUnique({ where: { key: VAPID_KEY } });
    const stored = StoredVapidSchema.safeParse(row?.value);
    if (stored.success) {
      const privateKey = this.deps.vault.reveal(stored.data.privateKey, PUSH_PURPOSE);
      if (privateKey) {
        this.vapid = { publicKey: stored.data.publicKey, privateKey };
        return this.vapid;
      }
    }
    const keys = generateVapidKeys();
    const value = {
      publicKey: keys.publicKey,
      privateKey: this.deps.vault.seal(keys.privateKey, PUSH_PURPOSE),
    };
    await this.deps.prisma.appSetting.upsert({
      where: { key: VAPID_KEY },
      create: { key: VAPID_KEY, value },
      update: { value },
    });
    this.deps.logger.info("Created the keys for browser notifications");
    this.vapid = keys;
    return keys;
  }
}
