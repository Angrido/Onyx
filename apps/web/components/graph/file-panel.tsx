"use client";

import type { FileContextDto } from "@onyx/contracts";
import { useQuery } from "@tanstack/react-query";
import { Crosshair, Lock, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { api, errorMessage } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/keys";
import { DOMAIN_LABELS, domainColor } from "@/lib/domains";
import { formatTokens } from "@/lib/format";
import { cn } from "@/lib/utils";

const LEVELS = [
  { level: 1, label: "Signatures" },
  { level: 2, label: "Contracts" },
  { level: 3, label: "Source" },
] as const;

function PathList({
  title,
  paths,
  onSelect,
}: {
  title: string;
  paths: string[];
  onSelect: (path: string) => void;
}) {
  if (paths.length === 0) return null;
  return (
    <div className="space-y-1">
      <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {title} · {paths.length}
      </p>
      <ul className="max-h-36 space-y-0.5 overflow-auto">
        {paths.map((path) => (
          <li key={path}>
            <button
              type="button"
              onClick={() => onSelect(path)}
              className="w-full truncate text-left font-mono text-[11px] text-muted-foreground hover:text-foreground"
            >
              {path}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function FilePanel({
  projectId,
  path,
  onSelect,
  onFocus,
  onClose,
}: {
  projectId: string;
  path: string;
  onSelect: (path: string) => void;
  onFocus: (path: string) => void;
  onClose: () => void;
}) {
  const [level, setLevel] = useState<1 | 2 | 3>(1);
  const { data, isPending, error } = useQuery({
    queryKey: queryKeys.fileContext(projectId, path, level),
    queryFn: () =>
      api.get<FileContextDto>(
        `/api/projects/${projectId}/context?path=${encodeURIComponent(path)}&level=${level}`,
      ),
  });

  return (
    <Card className="flex min-h-0 flex-col gap-3 p-4">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1 space-y-1">
          <p className="break-all font-mono text-xs">{path}</p>
          {data ? (
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span
                  className="size-2 rounded-full"
                  style={{ backgroundColor: domainColor(data.domain) }}
                />
                {data.domain ? DOMAIN_LABELS[data.domain] : "Shared"}
              </span>
              <span>{formatTokens(data.rawTokens)} tokens</span>
              {data.l1Tokens !== null ? <span>L1 {formatTokens(data.l1Tokens)}</span> : null}
              {data.blastRadius !== null ? <span>blast radius {data.blastRadius}</span> : null}
              {data.sensitive ? (
                <span className="flex items-center gap-1 text-warning">
                  <Lock className="size-3" />
                  withheld
                </span>
              ) : null}
            </p>
          ) : null}
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => onFocus(path)}
          title="Focus the graph here"
        >
          <Crosshair />
        </Button>
        <Button variant="ghost" size="icon" onClick={onClose} title="Close">
          <X />
        </Button>
      </div>

      <div className="flex gap-1 rounded-lg bg-surface-0/60 p-1">
        {LEVELS.map((option) => (
          <button
            key={option.level}
            type="button"
            onClick={() => setLevel(option.level)}
            className={cn(
              "flex-1 rounded-md px-2 py-1 text-xs transition-colors",
              level === option.level
                ? "bg-surface-3 text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {option.label}
          </button>
        ))}
      </div>

      {isPending ? (
        <Skeleton className="h-48" />
      ) : error ? (
        <p className="text-xs text-destructive">{errorMessage(error)}</p>
      ) : data ? (
        <>
          <pre className="scrollbar-thin max-h-[45vh] min-h-24 overflow-auto rounded-md bg-surface-0/70 p-3 font-mono text-[11px] leading-relaxed text-muted-foreground">
            {data.content}
          </pre>
          <p className="text-[11px] text-muted-foreground">
            This view costs {formatTokens(data.tokens)} tokens
            {data.rawTokens > 0
              ? ` (${Math.round((data.tokens / data.rawTokens) * 100)}% of the file)`
              : ""}
            .
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <PathList title="Imports" paths={data.dependencies} onSelect={onSelect} />
            <PathList title="Imported by" paths={data.dependents} onSelect={onSelect} />
          </div>
          {data.externalImports.length > 0 ? (
            <p className="text-[11px] text-muted-foreground">
              External: <span className="font-mono">{data.externalImports.join(", ")}</span>
            </p>
          ) : null}
        </>
      ) : null}
    </Card>
  );
}
