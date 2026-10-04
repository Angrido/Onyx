"use client";

import type {
  NotificationChannel,
  NotificationEvents,
  NotificationSettingsDto,
  PushKeyResponse,
  TestNotificationResponse,
  UpdateNotificationSettingsRequest,
} from "@onyx/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, BellOff, Loader2, Save, Send } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/form-controls";
import { api, errorMessage } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/keys";
import { useT } from "@/lib/i18n/client";
import {
  EVENT_LABELS,
  EVENT_ORDER,
  PUSH_SUPPORT_TEXT,
  applicationServerKey,
  pushSupport,
  type PushSupport,
} from "@/lib/notifications";

function usePushSupport(): PushSupport | null {
  const [support, setSupport] = useState<PushSupport | null>(null);
  useEffect(() => {
    const timer = setTimeout(
      () =>
        setSupport(
          pushSupport({
            isSecureContext: window.isSecureContext,
            hasServiceWorker: "serviceWorker" in navigator,
            hasPushManager: "PushManager" in window,
            permission: "Notification" in window ? Notification.permission : null,
          }),
        ),
      0,
    );
    return () => clearTimeout(timer);
  }, []);
  return support;
}

function SectionTitle({ children }: { children: string }) {
  return (
    <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
      {children}
    </p>
  );
}

function TestButton({ channel, disabled }: { channel: NotificationChannel; disabled: boolean }) {
  const t = useT();
  const test = useMutation({
    mutationFn: () => api.post<TestNotificationResponse>("/api/notifications/test", { channel }),
    onSuccess: (result) => (result.ok ? toast.success(result.detail) : toast.error(result.detail)),
    onError: (error) => toast.error(errorMessage(error, t)),
  });
  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      disabled={disabled || test.isPending}
      onClick={() => test.mutate()}
      data-testid={`notify-test-${channel}`}
    >
      {test.isPending ? <Loader2 className="animate-spin" /> : <Send />}
      {t("Send a test")}
    </Button>
  );
}

function BrowserPush({ settings }: { settings: NotificationSettingsDto }) {
  const t = useT();
  const queryClient = useQueryClient();
  const support = usePushSupport();
  const [subscribed, setSubscribed] = useState<boolean | null>(null);

  useEffect(() => {
    if (!support?.ok) return;
    let active = true;
    void navigator.serviceWorker
      .getRegistration("/sw.js")
      .then((registration) => registration?.pushManager.getSubscription())
      .then((subscription) => {
        if (active) setSubscribed(Boolean(subscription));
      })
      .catch(() => {
        if (active) setSubscribed(false);
      });
    return () => {
      active = false;
    };
  }, [support]);

  const toggle = useMutation({
    mutationFn: async (enable: boolean) => {
      const registration = await navigator.serviceWorker.register("/sw.js");
      const current = await registration.pushManager.getSubscription();
      if (!enable) {
        if (current) {
          await api.post("/api/notifications/push/unsubscribe", { endpoint: current.endpoint });
          await current.unsubscribe();
        }
        return api.get<NotificationSettingsDto>("/api/settings/notifications");
      }
      if ((await Notification.requestPermission()) !== "granted")
        throw new Error(t("Notifications were not allowed in this browser"));
      const { publicKey } = await api.get<PushKeyResponse>("/api/notifications/push/key");
      const subscription =
        current ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: applicationServerKey(publicKey),
        }));
      return api.post<NotificationSettingsDto>(
        "/api/notifications/push/subscriptions",
        subscription.toJSON(),
      );
    },
    onSuccess: (next, enable) => {
      queryClient.setQueryData(queryKeys.notifications, next);
      setSubscribed(enable);
      toast.success(
        enable ? t("This browser will get notifications") : t("Notifications turned off here"),
      );
    },
    onError: (error) => toast.error(errorMessage(error, t)),
  });

  return (
    <div className="space-y-2">
      <SectionTitle>{t("This browser")}</SectionTitle>
      {support && !support.ok ? (
        <p className="text-xs text-muted-foreground" data-testid="push-unavailable">
          {t(PUSH_SUPPORT_TEXT[support.reason])}
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={support === null || subscribed === null || toggle.isPending}
            onClick={() => toggle.mutate(!subscribed)}
          >
            {toggle.isPending ? <Loader2 className="animate-spin" /> : null}
            {!toggle.isPending && subscribed ? <BellOff /> : null}
            {!toggle.isPending && !subscribed ? <Bell /> : null}
            {subscribed ? t("Turn off on this device") : t("Turn on for this device")}
          </Button>
          <TestButton channel="webpush" disabled={settings.webPush.devices === 0} />
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        {settings.webPush.devices === 0
          ? t("No device subscribed.")
          : settings.webPush.devices === 1
            ? t("1 device subscribed.")
            : t("{count} devices subscribed.", { count: settings.webPush.devices })}
      </p>
    </div>
  );
}

export function NotificationsCard({ initial }: { initial: NotificationSettingsDto }) {
  const t = useT();
  const queryClient = useQueryClient();
  const { data: settings = initial } = useQuery({
    queryKey: queryKeys.notifications,
    queryFn: () => api.get<NotificationSettingsDto>("/api/settings/notifications"),
    initialData: initial,
  });
  const [events, setEvents] = useState<NotificationEvents>(initial.events);
  const [ntfyEnabled, setNtfyEnabled] = useState(initial.ntfy.enabled);
  const [server, setServer] = useState(initial.ntfy.server || "https://ntfy.sh");
  const [topic, setTopic] = useState(initial.ntfy.topic);
  const [ntfyToken, setNtfyToken] = useState("");
  const [telegramEnabled, setTelegramEnabled] = useState(initial.telegram.enabled);
  const [chatId, setChatId] = useState(initial.telegram.chatId);
  const [botToken, setBotToken] = useState("");

  const save = useMutation({
    mutationFn: (input: UpdateNotificationSettingsRequest) =>
      api.put<NotificationSettingsDto>("/api/settings/notifications", input),
    onSuccess: (next) => {
      queryClient.setQueryData(queryKeys.notifications, next);
      setNtfyToken("");
      setBotToken("");
      toast.success(t("Notification settings saved"));
    },
    onError: (error) => toast.error(errorMessage(error, t)),
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    save.mutate({
      events,
      ntfy: {
        enabled: ntfyEnabled,
        server: ntfyEnabled || topic ? server.trim() : "",
        topic: topic.trim(),
        ...(ntfyToken.trim() ? { token: ntfyToken.trim() } : {}),
      },
      telegram: {
        enabled: telegramEnabled,
        chatId: chatId.trim(),
        ...(botToken.trim() ? { token: botToken.trim() } : {}),
      },
    });
  }

  return (
    <Card id="notifications" data-testid="notifications-card">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <Bell className="size-4 text-primary" />
          {t("Notifications")}
        </CardTitle>
        <CardDescription>
          {t(
            "Hear about runs, approvals, budgets and Claude limits away from the screen. Onyx only sends: it never reads messages from these services. Everything is off until you turn it on.",
          )}{" "}
          {settings.linkBase
            ? t("Links open {url}.", { url: settings.linkBase })
            : t("Set ONYX_PUBLIC_ORIGIN to add links.")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <BrowserPush settings={settings} />
        <form className="space-y-5" onSubmit={submit}>
          <fieldset className="space-y-2">
            <legend className="mb-2">
              <SectionTitle>{t("Tell me when")}</SectionTitle>
            </legend>
            {EVENT_ORDER.map((event) => (
              <label key={event} className="flex min-h-6 items-start gap-2.5 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5 size-4 shrink-0 accent-[var(--primary)]"
                  checked={events[event]}
                  onChange={(change) => setEvents({ ...events, [event]: change.target.checked })}
                />
                <span>
                  {t(EVENT_LABELS[event].label)}
                  <span className="block text-xs text-muted-foreground">
                    {t(EVENT_LABELS[event].hint)}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>
          <div className="space-y-2 border-t border-border pt-4">
            <div className="flex items-center justify-between gap-2">
              <label className="flex items-center gap-2.5 text-sm font-medium">
                <input
                  type="checkbox"
                  className="size-4 accent-[var(--primary)]"
                  checked={ntfyEnabled}
                  onChange={(change) => setNtfyEnabled(change.target.checked)}
                  data-testid="ntfy-enabled"
                />
                ntfy
              </label>
              <TestButton channel="ntfy" disabled={!settings.ntfy.topic} />
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <label className="space-y-1 text-xs">
                <span className="text-muted-foreground">{t("Server")}</span>
                <Input
                  type="url"
                  value={server}
                  onChange={(change) => setServer(change.target.value)}
                  className="h-9"
                  data-testid="ntfy-server"
                />
              </label>
              <label className="space-y-1 text-xs">
                <span className="text-muted-foreground">{t("Topic")}</span>
                <Input
                  value={topic}
                  onChange={(change) => setTopic(change.target.value)}
                  placeholder={"onyx-a7k2"}
                  className="h-9"
                  data-testid="ntfy-topic"
                />
              </label>
            </div>
            <label className="block space-y-1 text-xs">
              <span className="flex items-center gap-2 text-muted-foreground">
                {t("Access token (optional)")}
                {settings.ntfy.hasToken ? (
                  <Badge tone="success">{t("saved, encrypted")}</Badge>
                ) : null}
              </span>
              <Input
                type="password"
                autoComplete="off"
                value={ntfyToken}
                onChange={(change) => setNtfyToken(change.target.value)}
                placeholder={settings.ntfy.hasToken ? t("Leave empty to keep it") : "tk_…"}
                className="h-9"
              />
            </label>
            <p className="text-xs text-muted-foreground">
              {t(
                "On a public server anyone who knows the topic can read it: pick a long, random name or use your own server.",
              )}
            </p>
          </div>
          <div className="space-y-2 border-t border-border pt-4">
            <div className="flex items-center justify-between gap-2">
              <label className="flex items-center gap-2.5 text-sm font-medium">
                <input
                  type="checkbox"
                  className="size-4 accent-[var(--primary)]"
                  checked={telegramEnabled}
                  onChange={(change) => setTelegramEnabled(change.target.checked)}
                />
                {"Telegram"}
              </label>
              <TestButton channel="telegram" disabled={!settings.telegram.hasToken} />
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <label className="space-y-1 text-xs">
                <span className="flex items-center gap-2 text-muted-foreground">
                  {t("Bot token")}
                  {settings.telegram.hasToken ? (
                    <Badge tone="success">{t("saved, encrypted")}</Badge>
                  ) : null}
                </span>
                <Input
                  type="password"
                  autoComplete="off"
                  value={botToken}
                  onChange={(change) => setBotToken(change.target.value)}
                  placeholder={
                    settings.telegram.hasToken ? t("Leave empty to keep it") : "123456:ABC…"
                  }
                  className="h-9"
                />
              </label>
              <label className="space-y-1 text-xs">
                <span className="text-muted-foreground">{t("Chat id")}</span>
                <Input
                  value={chatId}
                  onChange={(change) => setChatId(change.target.value)}
                  placeholder="123456789"
                  className="h-9"
                />
              </label>
            </div>
          </div>
          <Button size="sm" variant="secondary" disabled={save.isPending}>
            {save.isPending ? <Loader2 className="animate-spin" /> : <Save />}
            {t("Save")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
