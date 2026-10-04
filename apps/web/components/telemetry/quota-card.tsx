"use client";

import type { QuotaDto, QuotaSettings } from "@onyx/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Gauge, Loader2, Play, Save } from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/form-controls";
import { api, errorMessage } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/keys";
import { formatPercent } from "@/lib/format";
import { useQuota } from "@/lib/live";
import { QUOTA_LEVEL_STYLES, formatReset, quotaStatusLabel, quotaWindowLabel } from "@/lib/quota";
import { cn } from "@/lib/utils";

const BAR_TONES = {
  neutral: "bg-muted-foreground/50",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-destructive",
} as const;

function barTone(utilization: number | null, status: string, settings: QuotaSettings) {
  if (status === "rejected") return BAR_TONES.danger;
  if (utilization === null) return BAR_TONES.neutral;
  if (utilization >= settings.holdAt) return BAR_TONES.danger;
  if (utilization >= settings.warnAt || status === "allowed_warning") return BAR_TONES.warning;
  return BAR_TONES.success;
}

function SettingsForm({ quota }: { quota: QuotaDto }) {
  const queryClient = useQueryClient();
  const [warnAt, setWarnAt] = useState(String(Math.round(quota.settings.warnAt * 100)));
  const [holdAt, setHoldAt] = useState(String(Math.round(quota.settings.holdAt * 100)));
  const [deferEnabled, setDeferEnabled] = useState(quota.settings.deferEnabled);
  const save = useMutation({
    mutationFn: (settings: QuotaSettings) => api.put<QuotaDto>("/api/quota/settings", settings),
    onSuccess: (next) => {
      queryClient.setQueryData(queryKeys.quota, next);
      toast.success("Limit settings saved");
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    save.mutate({ warnAt: Number(warnAt) / 100, holdAt: Number(holdAt) / 100, deferEnabled });
  }

  return (
    <form className="space-y-3 border-t border-border pt-4" onSubmit={submit}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-xs">
          <span className="text-muted-foreground">Warn from (% used)</span>
          <Input
            type="number"
            min={50}
            max={99}
            required
            value={warnAt}
            onChange={(event) => setWarnAt(event.target.value)}
            className="h-9"
          />
        </label>
        <label className="space-y-1 text-xs">
          <span className="text-muted-foreground">Hold tasks that can wait from (% used)</span>
          <Input
            type="number"
            min={50}
            max={100}
            required
            value={holdAt}
            onChange={(event) => setHoldAt(event.target.value)}
            className="h-9"
          />
        </label>
      </div>
      <label className="flex min-h-6 items-center gap-2.5 text-sm">
        <input
          type="checkbox"
          className="size-4 accent-[var(--primary)]"
          checked={deferEnabled}
          onChange={(event) => setDeferEnabled(event.target.checked)}
        />
        Hold tasks marked “can wait” near the limit
      </label>
      <Button size="sm" variant="secondary" disabled={save.isPending}>
        {save.isPending ? <Loader2 className="animate-spin" /> : <Save />}
        Save
      </Button>
    </form>
  );
}

export function QuotaCard({ initial }: { initial: QuotaDto }) {
  const queryClient = useQueryClient();
  const { data: quota = initial } = useQuota(initial);
  const style = QUOTA_LEVEL_STYLES[quota.level];
  const resume = useMutation({
    mutationFn: () => api.post<QuotaDto>("/api/quota/resume"),
    onSuccess: (next) => queryClient.setQueryData(queryKeys.quota, next),
    onError: (error) => toast.error(errorMessage(error)),
  });
  const held = quota.level === "LIMITED" || (quota.level === "HOLDING" && quota.deferredTasks > 0);

  return (
    <Card id="quota" data-testid="quota-card">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <Gauge className="size-4 text-primary" />
          Claude subscription limits
          <Badge tone={style.tone} data-testid="quota-level">
            {style.label}
          </Badge>
        </CardTitle>
        <CardDescription>
          Claude Code reports how much of the subscription windows is used while runs are going.
          Near the limit Onyx holds the tasks marked “can wait” and starts them again when the
          window resets.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm" data-testid="quota-message">
          {quota.message}
          {quota.nextResetAt ? ` Resets ${formatReset(quota.nextResetAt)}.` : ""}
        </p>
        {quota.windows.length > 0 ? (
          <ul className="space-y-3">
            {quota.windows.map((window) => (
              <li key={window.type} className={cn("space-y-1.5", window.stale && "opacity-60")}>
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-xs">
                  <span className="font-medium text-foreground">
                    {quotaWindowLabel(window.type)}
                  </span>
                  <span className="text-muted-foreground">
                    {window.stale
                      ? "reset since the last report"
                      : `${quotaStatusLabel(window.status)}${window.utilization === null ? "" : ` · ${formatPercent(window.utilization)} used`} · resets ${formatReset(window.resetsAt)}`}
                  </span>
                </div>
                <div
                  className="h-1.5 overflow-hidden rounded-full bg-surface-3"
                  role="meter"
                  aria-label={`${quotaWindowLabel(window.type)} used`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round((window.utilization ?? 0) * 100)}
                >
                  <div
                    className={cn(
                      "h-full rounded-full",
                      barTone(window.utilization, window.status, quota.settings),
                    )}
                    style={{
                      width: `${Math.min(100, Math.round((window.utilization ?? (window.status === "rejected" ? 1 : 0)) * 100))}%`,
                    }}
                  />
                </div>
              </li>
            ))}
          </ul>
        ) : null}
        {held ? (
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-warning/40 bg-warning/8 p-3 text-xs">
            <span className="min-w-0 flex-1">
              {quota.level === "LIMITED"
                ? "All queued runs wait. Resume if the limit has already reset or you switched account."
                : `${quota.deferredTasks} ${quota.deferredTasks === 1 ? "task waits" : "tasks wait"} for the window to reset.`}
            </span>
            <Button
              size="sm"
              variant="secondary"
              disabled={resume.isPending}
              onClick={() => resume.mutate()}
            >
              {resume.isPending ? <Loader2 className="animate-spin" /> : <Play />}
              Resume now
            </Button>
          </div>
        ) : null}
        <SettingsForm key={JSON.stringify(quota.settings)} quota={quota} />
      </CardContent>
    </Card>
  );
}
