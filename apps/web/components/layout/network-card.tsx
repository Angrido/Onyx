"use client";

import type { NetworkInfo } from "@onyx/contracts";
import { useQuery } from "@tanstack/react-query";
import { Check, Copy, Wifi } from "lucide-react";
import { useState } from "react";
import { Card } from "@/components/ui/card";
import { api } from "@/lib/api/client";
import { useT } from "@/lib/i18n/client";

function CopyableUrl({ url, current }: { url: string; current: boolean }) {
  const t = useT();
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard?.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1_500);
  }

  return (
    <button
      type="button"
      onClick={() => void copy()}
      className="group flex items-center gap-2 rounded-md border border-border bg-surface-0/60 px-2.5 py-1.5 font-mono text-xs transition-colors hover:border-border-strong"
      title={t("Copy address")}
    >
      <span className={current ? "text-foreground" : "text-muted-foreground"}>{url}</span>
      {copied ? (
        <Check className="size-3.5 text-success" />
      ) : (
        <Copy className="size-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
      )}
    </button>
  );
}

export function NetworkCard() {
  const t = useT();
  const { data } = useQuery({
    queryKey: ["network"],
    queryFn: () => api.get<NetworkInfo>("/api/system/network"),
    staleTime: 60_000,
  });
  if (!data) return null;
  const urls = [...new Set([data.currentOrigin, ...data.urls].filter((url) => url !== null))];

  return (
    <Card className="flex flex-wrap items-center gap-3 px-5 py-3">
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        <Wifi className="size-3.5" />
        {t("On your network")}
      </div>
      <div className="flex flex-wrap gap-2">
        {urls.map((url) => (
          <CopyableUrl key={url} url={url} current={url === data.currentOrigin} />
        ))}
      </div>
    </Card>
  );
}
