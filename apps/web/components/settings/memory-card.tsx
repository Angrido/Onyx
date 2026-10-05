"use client";

import type { MemorySettings } from "@onyx/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Brain, Loader2, Save } from "lucide-react";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/form-controls";
import { HelpTip } from "@/components/ui/help-tip";
import { api, errorMessage } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/keys";
import { useT } from "@/lib/i18n/client";

const BUDGETS = [400, 800, 1200, 2000];
const EXPIRIES = [14, 30, 60, 90];

export function MemoryCard({ initial }: { initial: MemorySettings }) {
  const t = useT();
  const queryClient = useQueryClient();
  const [settings, setSettings] = useState(initial);
  const save = useMutation({
    mutationFn: (next: MemorySettings) => api.put<MemorySettings>("/api/settings/memory", next),
    onSuccess: (next) => {
      queryClient.setQueryData(queryKeys.memorySettings, next);
      void queryClient.invalidateQueries({ queryKey: queryKeys.savings });
      toast.success(t("Memory settings saved"));
    },
    onError: (error) => toast.error(errorMessage(error, t)),
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    save.mutate(settings);
  }

  return (
    <Card id="memory" data-testid="memory-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Brain className="size-4 text-primary" />
          {t("Project memory")}
          <HelpTip term="memory" />
        </CardTitle>
        <CardDescription>
          {t(
            "Onyx remembers short facts about each project, such as the test command or the files that matter, and gives them to new sessions so Claude explores less. You confirm, edit and forget them on the memory page of each project.",
          )}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-3" onSubmit={submit}>
          <label className="flex min-h-6 items-center gap-2.5 text-sm">
            <input
              type="checkbox"
              className="size-4 accent-[var(--primary)]"
              checked={settings.enabled}
              onChange={(event) => setSettings({ ...settings, enabled: event.target.checked })}
              data-testid="memory-enabled"
            />
            {t("Give new sessions the project memory")}
          </label>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-xs">
              <span className="text-muted-foreground">{t("Limit")}</span>
              <Select
                value={String(settings.budgetTokens)}
                onChange={(event) =>
                  setSettings({ ...settings, budgetTokens: Number(event.target.value) })
                }
              >
                {BUDGETS.map((value) => (
                  <option key={value} value={value}>
                    {t("{count} tokens", { count: value })}
                  </option>
                ))}
              </Select>
            </label>
            <label className="space-y-1 text-xs">
              <span className="text-muted-foreground">{t("Forget facts not seen for")}</span>
              <Select
                value={String(settings.expiryDays)}
                onChange={(event) =>
                  setSettings({ ...settings, expiryDays: Number(event.target.value) })
                }
              >
                {EXPIRIES.map((value) => (
                  <option key={value} value={value}>
                    {t("{count} days", { count: value })}
                  </option>
                ))}
              </Select>
            </label>
          </div>
          <label className="flex min-h-6 items-start gap-2.5 text-sm">
            <input
              type="checkbox"
              className="mt-0.5 size-4 shrink-0 accent-[var(--primary)]"
              checked={settings.experiment}
              disabled={!settings.enabled}
              onChange={(event) => setSettings({ ...settings, experiment: event.target.checked })}
              data-testid="memory-experiment"
            />
            <span>
              {t("Measure it: half of the new sessions start without memory")}
              <span className="block text-xs text-muted-foreground">
                {t("The result appears in")}{" "}
                <Link
                  href="/savings#memory-experiment"
                  className="text-primary underline underline-offset-2"
                >
                  {t("Savings")}
                </Link>{" "}
                {t("after 10 runs per group.")}
              </span>
            </span>
          </label>
          <Button size="sm" variant="secondary" disabled={save.isPending}>
            {save.isPending ? <Loader2 className="animate-spin" /> : <Save />}
            {t("Save")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
