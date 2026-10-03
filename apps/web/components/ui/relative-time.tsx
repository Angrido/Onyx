"use client";

import { useEffect, useState } from "react";
import { formatRelative } from "@/lib/format";

export function RelativeTime({ iso, className }: { iso: string; className?: string }) {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, 30_000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, []);

  return (
    <time dateTime={iso} className={className} title={new Date(iso).toISOString()}>
      {now === null ? new Date(iso).toISOString().slice(11, 16) : formatRelative(iso, now)}
    </time>
  );
}
