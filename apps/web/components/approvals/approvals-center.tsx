"use client";

import type { ApprovalDto, ApprovalListResponse } from "@onyx/contracts";
import { channels } from "@onyx/contracts/client";
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
import { HelpTip } from "@/components/ui/help-tip";
import { RelativeTime } from "@/components/ui/relative-time";
import { api, errorMessage } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/keys";
import { useT } from "@/lib/i18n/client";
import { msg, type Translate } from "@/lib/i18n/core";
import { APPROVAL_KIND_LABELS, APPROVAL_KIND_TONES, sortApprovals } from "@/lib/orchestration";
import { APPROVAL_GROUP_TITLES, approvalOutcome, groupApprovals } from "@/lib/plan-guide";
import { cn } from "@/lib/utils";
import { useChannel } from "@/lib/ws/context";

const STATUS_LABELS: Record<ApprovalDto["status"], string> = {
  PENDING: msg("Waiting"),
  APPROVED: msg("Approved"),
  REJECTED: msg("Rejected"),
  EXPIRED: msg("Expired"),
};

const DECISION_LABELS = new Set([
  msg("Approve"),
  msg("Reject"),
  msg("Continue this period"),
  msg("Keep runs paused"),
  msg("Approve and run"),
  msg("Discard the plan"),
  msg("Merge anyway"),
  msg("Drop this task"),
  msg("Retry the merge"),
  msg("Apply the resolution"),
  msg("Resolve it myself"),
]);

function decisionLabel(label: string, t: Translate): string {
  return DECISION_LABELS.has(label) ? t(label) : label;
}

function PendingApproval({ approval }: { approval: ApprovalDto }) {
  const t = useT();
  const queryClient = useQueryClient();
  const [note, setNote] = useState("");
  const outcome = approvalOutcome(approval);
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
      toast.success(
        decisionLabel(
          updated.status === "APPROVED" ? approval.approveLabel : approval.rejectLabel,
          t,
        ),
      );
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
              {t(APPROVAL_KIND_LABELS[approval.kind])}
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
          <ul className="space-y-1 text-xs" data-testid="approval-outcome">
            <li className="flex gap-1.5">
              <Check className="mt-0.5 size-3.5 shrink-0 text-success" aria-hidden="true" />
              <span>{t(outcome.approve)}</span>
            </li>
            <li className="flex gap-1.5 text-muted-foreground">
              <X className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              <span>{t(outcome.reject)}</span>
            </li>
          </ul>
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
              placeholder={t("Note (optional)")}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              className="sm:max-w-xs"
              aria-label={t("Note")}
            />
            <div className="flex flex-wrap gap-2 sm:ml-auto">
              {approval.link ? (
                <Button asChild variant="ghost" size="sm">
                  <Link href={approval.link}>
                    {t("Open")}
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
                {decisionLabel(approval.rejectLabel, t)}
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
                {decisionLabel(approval.approveLabel, t)}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

function DecidedApproval({ approval }: { approval: ApprovalDto }) {
  const t = useT();
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm">
      <Badge tone={APPROVAL_KIND_TONES[approval.kind]}>
        {t(APPROVAL_KIND_LABELS[approval.kind])}
      </Badge>
      <span className="min-w-0 flex-1 basis-48 truncate">{approval.title}</span>
      <span
        className={cn(
          "min-w-0 text-xs",
          approval.status === "APPROVED" ? "text-success" : "text-muted-foreground",
        )}
      >
        {t(STATUS_LABELS[approval.status])}
        {approval.decidedBy
          ? ` ${t("by {name}", { name: approval.decidedBy.replace(/^user:/, "") })}`
          : ""}
        {approval.note ? ` · “${approval.note}”` : ""}
      </span>
      {approval.decidedAt ? (
        <RelativeTime iso={approval.decidedAt} className="shrink-0 text-xs text-muted-foreground" />
      ) : null}
    </div>
  );
}

export function ApprovalsCenter({ initial }: { initial: ApprovalListResponse }) {
  const t = useT();
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
        <h2 className="flex items-center gap-0.5 text-sm font-semibold tracking-tight">
          {t("Waiting for you")}
          {pending.length > 0 ? ` · ${pending.length}` : ""}
          <HelpTip term="approval" />
        </h2>
        {pending.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-2 p-10 text-center">
              <Inbox className="size-6 text-muted-foreground" />
              <p className="text-sm font-medium">{t("Nothing to decide")}</p>
              <p className="max-w-sm text-xs text-muted-foreground">
                {t(
                  "Plans to approve, merge conflicts and budgets that passed their soft limit appear here.",
                )}
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-6">
            {groupApprovals(pending).map((group) => (
              <section
                key={group.kind}
                className="space-y-3"
                aria-labelledby={`approvals-${group.kind}`}
                data-testid="approval-group"
              >
                <h3
                  id={`approvals-${group.kind}`}
                  className="text-xs font-medium uppercase tracking-wider text-muted-foreground"
                >
                  {t(APPROVAL_GROUP_TITLES[group.kind])} · {group.items.length}
                </h3>
                <AnimatePresence initial={false}>
                  {group.items.map((approval) => (
                    <PendingApproval key={approval.id} approval={approval} />
                  ))}
                </AnimatePresence>
              </section>
            ))}
          </div>
        )}
      </section>
      {decided.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold tracking-tight">{t("History")}</h2>
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
