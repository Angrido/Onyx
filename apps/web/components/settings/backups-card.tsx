"use client";

import type { BackupDto, BackupListResponse, BackupVerifyResult } from "@onyx/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Check,
  Copy,
  DatabaseBackup,
  Download,
  Loader2,
  Plus,
  ShieldCheck,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { RelativeTime } from "@/components/ui/relative-time";
import { api, errorMessage } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/keys";
import { formatBytes } from "@/lib/format";

const REASONS: Record<
  NonNullable<BackupDto["reason"]>,
  { label: string; tone: NonNullable<BadgeProps["tone"]> }
> = {
  manual: { label: "Manual", tone: "primary" },
  scheduled: { label: "Daily", tone: "neutral" },
  "pre-update": { label: "Before update", tone: "architect" },
  "pre-restore": { label: "Before restore", tone: "warning" },
};

function BackupRow({ backup }: { backup: BackupDto }) {
  const [copied, setCopied] = useState(false);
  const verify = useMutation({
    mutationFn: () => api.post<BackupVerifyResult>(`/api/backups/${backup.name}/verify`),
    onSuccess: (result) => {
      if (result.ok) toast.success(`${backup.name} is intact`);
      else toast.error(result.problems.join("; "));
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const reason = backup.reason ? REASONS[backup.reason] : null;
  const command = `onyx restore ${backup.name}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1_500);
    } catch {
      toast.info(command);
    }
  }

  return (
    <li className="space-y-2 py-3" data-testid="backup">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs">{backup.name}</span>
        {reason ? <Badge tone={reason.tone}>{reason.label}</Badge> : null}
        {backup.keyMatches === false ? (
          <Badge tone="warning" title="Tokens in this backup were sealed with another secret key">
            <AlertTriangle className="size-3" />
            other key
          </Badge>
        ) : null}
        <span className="ml-auto text-xs text-muted-foreground">
          <RelativeTime iso={backup.createdAt} /> · {formatBytes(backup.sizeBytes)}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">
          {backup.counts["Project"] ?? "?"} projects · {backup.counts["Task"] ?? "?"} tasks
          {backup.migrations > 0 ? ` · ${backup.migrations} migrations` : ""}
        </span>
        <div className="ml-auto flex flex-wrap gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => verify.mutate()}
            disabled={verify.isPending}
          >
            {verify.isPending ? <Loader2 className="animate-spin" /> : <ShieldCheck />}
            Verify
          </Button>
          <Button asChild variant="ghost" size="sm">
            <a href={`/api/backups/${backup.name}/download`} download={backup.name}>
              <Download />
              Download
            </a>
          </Button>
          <Button variant="ghost" size="sm" onClick={() => void copy()} title={command}>
            {copied ? <Check /> : <Copy />}
            Restore command
          </Button>
        </div>
      </div>
    </li>
  );
}

export function BackupsCard({ initial }: { initial: BackupListResponse }) {
  const queryClient = useQueryClient();
  const { data = initial } = useQuery({
    queryKey: queryKeys.backups,
    queryFn: () => api.get<BackupListResponse>("/api/backups"),
    initialData: initial,
  });
  const create = useMutation({
    mutationFn: () => api.post<BackupDto>("/api/backups"),
    onSuccess: (backup) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.backups });
      toast.success(`Backup written: ${backup.name}`);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <DatabaseBackup className="size-4 text-primary" />
          Backups
        </CardTitle>
        <CardDescription>
          {data.intervalHours > 0
            ? `Onyx copies its database every ${data.intervalHours === 24 ? "day" : `${data.intervalHours} hours`} and keeps the newest ${data.keep}.`
            : `Automatic backups are off; Onyx keeps the newest ${data.keep}.`}{" "}
          Copies are consistent while agents run and are checked before they are kept. Saved tokens
          stay encrypted: keep the secret key file safe to restore them on another machine.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={() => create.mutate()} disabled={create.isPending || data.running}>
            {create.isPending ? <Loader2 className="animate-spin" /> : <Plus />}
            Back up now
          </Button>
          <p className="text-xs text-muted-foreground">
            {data.lastBackupAt ? (
              <>
                Last <RelativeTime iso={data.lastBackupAt} />
              </>
            ) : (
              "No backup yet"
            )}
            {data.nextBackupAt ? (
              <>
                {" · next "}
                <RelativeTime iso={data.nextBackupAt} />
              </>
            ) : null}
          </p>
        </div>
        {data.items.length > 0 ? (
          <ul className="divide-y divide-border">
            {data.items.map((backup) => (
              <BackupRow key={backup.name} backup={backup} />
            ))}
          </ul>
        ) : null}
        <p className="rounded-lg border border-border bg-surface-1 px-3 py-2 text-xs text-muted-foreground">
          To restore, run{" "}
          <code className="font-mono text-foreground">onyx restore &lt;name&gt;</code> on the Onyx
          machine: it stops Onyx, keeps a copy of the current database, restores the backup, applies
          the migrations and starts Onyx again. Files are in{" "}
          <span className="break-all font-mono">{data.dir}</span>.
        </p>
      </CardContent>
    </Card>
  );
}
