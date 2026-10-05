"use client";

import type { ApprovalListResponse, ServerMessage } from "@onyx/contracts";
import { channels } from "@onyx/contracts/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, Inbox } from "lucide-react";
import Link from "next/link";
import { useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { RelativeTime } from "@/components/ui/relative-time";
import { api } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/keys";
import { useT } from "@/lib/i18n/client";
import { APPROVAL_KIND_LABELS, APPROVAL_KIND_TONES } from "@/lib/orchestration";
import { useChannel } from "@/lib/ws/context";

const LIMIT = 4;

export function PendingApprovals({ initial }: { initial: ApprovalListResponse }) {
  const t = useT();
  const queryClient = useQueryClient();
  const { data = initial } = useQuery({
    queryKey: [...queryKeys.approvals, "console"],
    queryFn: () => api.get<ApprovalListResponse>(`/api/approvals?status=PENDING&limit=${LIMIT}`),
    initialData: initial,
  });
  const onMessage = useCallback(
    (message: ServerMessage) => {
      if (message.type === "approvals.changed")
        void queryClient.invalidateQueries({ queryKey: queryKeys.approvals });
    },
    [queryClient],
  );
  useChannel(channels.system, onMessage);

  if (data.pending === 0) return null;
  return (
    <section className="space-y-3" data-testid="console-approvals">
      <div className="flex items-center gap-2">
        <Inbox className="size-4 text-warning" />
        <h2 className="text-sm font-semibold tracking-tight">{t("Waiting for you")}</h2>
        <Badge tone="warning">{data.pending}</Badge>
        <Link
          href="/approvals"
          className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          {t("Open Approvals")}
          <ArrowRight className="size-3" />
        </Link>
      </div>
      <Card className="divide-y divide-border overflow-hidden border-warning/30">
        <AnimatePresence initial={false}>
          {data.items.map((approval) => (
            <motion.div
              key={approval.id}
              layout
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <Link
                href={approval.link ?? "/approvals"}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm transition-colors hover:bg-surface-2/60"
              >
                <Badge tone={APPROVAL_KIND_TONES[approval.kind]}>
                  {t(APPROVAL_KIND_LABELS[approval.kind])}
                </Badge>
                <span className="min-w-0 flex-1 basis-48 truncate">{approval.title}</span>
                <RelativeTime
                  iso={approval.createdAt}
                  className="shrink-0 text-xs text-muted-foreground"
                />
              </Link>
            </motion.div>
          ))}
        </AnimatePresence>
      </Card>
    </section>
  );
}
