"use client";

import { channels, type ApprovalDto, type ApprovalListResponse } from "@onyx/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, Check, FileWarning, Inbox, Loader2, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/form-controls";
import { RelativeTime } from "@/components/ui/relative-time";
import { api, errorMessage } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/keys";
import { APPROVAL_KIND_LABELS, APPROVAL_KIND_TONES, sortApprovals } from "@/lib/orchestration";
import { cn } from "@/lib/utils";
import { useChannel } from "@/lib/ws/context";

const STATUS_LABELS: Record<ApprovalDto["status"], string> = {
  PENDING: "Waiting",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  EXPIRED: "Expired",
};

function PendingApproval({ approval }: { approval: ApprovalDto }) {
  const queryClient = useQueryClient();
  const [note, setNote] = useState("");
  const decide = useMutation({
    mutationFn: (decision: "approve" | "reject") =>
      api.post<ApprovalDto>(`/api/approvals/${approval.id}/${decision}`, {
        ...(note.trim() ? { note: note.trim() } : {}),
      }),
    onSuccess: (updated) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.approvals });
      if (updated.orchestrationId)
        void queryClient.invalidateQueries({
          queryKey: queryKeys.orchestration(updated.orchestrationId),
        });
      void queryClient.invalidateQueries({ queryKey: queryKeys.budgets });
      toast.success(updated.status === "APPROVED" ? approval.approveLabel : approval.rejectLabel);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: 24 }}
      data-testid="approval"
      data-kind={approval.kind}
    >
      <Card className="border-warning/30">
        <CardContent className="space-y-3 p-5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={APPROVAL_KIND_TONES[approval.kind]}>
              {APPROVAL_KIND_LABELS[approval.kind]}
            </Badge>
            {approval.projectName ? <Badge>{approval.projectName}</Badge> : null}
            <span className="ml-auto text-xs text-muted-foreground">
              <RelativeTime iso={approval.createdAt} />
            </span>
          </div>
          <p className="text-sm font-semibold">{approval.title}</p>
          {approval.detail ? (
            <p className="text-sm leading-relaxed text-muted-foreground">{approval.detail}</p>
          ) : null}
          {approval.files.length > 0 ? (
            <ul className="space-y-1">
              {approval.files.map((file) => (
                <li key={file} className="flex items-center gap-2 font-mono text-xs text-warning">
                  <FileWarning className="size-3.5" />
                  {file}
                </li>
              ))}
            </ul>
          ) : null}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Input
              placeholder="Note (optional)"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              className="sm:max-w-xs"
              aria-label="Note"
            />
            <div className="flex flex-wrap gap-2 sm:ml-auto">
              {approval.link ? (
                <Button asChild variant="ghost" size="sm">
                  <Link href={approval.link}>
                    Open
                    <ArrowRight />
                  </Link>
                </Button>
              ) : null}
              <Button
                variant="secondary"
                size="sm"
                onClick={() => decide.mutate("reject")}
                disabled={decide.isPending}
              >
                {decide.isPending && decide.variables === "reject" ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <X />
                )}
                {approval.rejectLabel}
              </Button>
              <Button
                size="sm"
                onClick={() => decide.mutate("approve")}
                disabled={decide.isPending}
              >
                {decide.isPending && decide.variables === "approve" ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <Check />
                )}
                {approval.approveLabel}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

function DecidedApproval({ approval }: { approval: ApprovalDto }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm">
      <Badge tone={APPROVAL_KIND_TONES[approval.kind]}>{APPROVAL_KIND_LABELS[approval.kind]}</Badge>
      <span className="min-w-0 flex-1 basis-48 truncate">{approval.title}</span>
      <span
        className={cn(
          "min-w-0 text-xs",
          approval.status === "APPROVED" ? "text-success" : "text-muted-foreground",
        )}
      >
        {STATUS_LABELS[approval.status]}
        {approval.decidedBy ? ` by ${approval.decidedBy.replace(/^user:/, "")}` : ""}
        {approval.note ? ` · “${approval.note}”` : ""}
      </span>
      {approval.decidedAt ? (
        <RelativeTime iso={approval.decidedAt} className="shrink-0 text-xs text-muted-foreground" />
      ) : null}
    </div>
  );
}

export function ApprovalsCenter({ initial }: { initial: ApprovalListResponse }) {
  const queryClient = useQueryClient();
  const { data = initial } = useQuery({
    queryKey: queryKeys.approvals,
    queryFn: () => api.get<ApprovalListResponse>("/api/approvals?limit=60"),
    initialData: initial,
  });
  const onMessage = useCallback(
    (message: { type: string }) => {
      if (message.type === "approvals.changed")
        void queryClient.invalidateQueries({ queryKey: queryKeys.approvals });
    },
    [queryClient],
  );
  useChannel(channels.system, onMessage);

  const items = sortApprovals(data.items);
  const pending = items.filter((approval) => approval.status === "PENDING");
  const decided = items.filter((approval) => approval.status !== "PENDING");

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h2 className="text-sm font-semibold tracking-tight">
          Waiting for you{pending.length > 0 ? ` · ${pending.length}` : ""}
        </h2>
        {pending.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-2 p-10 text-center">
              <Inbox className="size-6 text-muted-foreground" />
              <p className="text-sm font-medium">Nothing to decide</p>
              <p className="max-w-sm text-xs text-muted-foreground">
                Plans to approve, merge conflicts and budgets that passed their soft limit appear
                here.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            <AnimatePresence initial={false}>
              {pending.map((approval) => (
                <PendingApproval key={approval.id} approval={approval} />
              ))}
            </AnimatePresence>
          </div>
        )}
      </section>
      {decided.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold tracking-tight">History</h2>
          <Card className="divide-y divide-border">
            {decided.map((approval) => (
              <DecidedApproval key={approval.id} approval={approval} />
            ))}
          </Card>
        </section>
      ) : null}
    </div>
  );
}
