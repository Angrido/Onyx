"use client";

import {
  AlertTriangle,
  Brain,
  CheckCircle2,
  ChevronRight,
  FilePen,
  FileSearch,
  FileText,
  FolderSearch,
  Loader2,
  Sparkles,
  SquareTerminal,
  User,
  Workflow,
  Wrench,
  XCircle,
} from "lucide-react";
import { motion } from "motion/react";
import { useState, type ReactNode } from "react";
import { RunStatusBadge } from "@/components/tasks/status-badge";
import type { FeedEntry, ToolResultView } from "@/lib/run-feed";
import { formatDuration, formatUsd } from "@/lib/format";
import { cn } from "@/lib/utils";

const TOOL_ICONS: Record<string, typeof Wrench> = {
  Read: FileText,
  Edit: FilePen,
  MultiEdit: FilePen,
  Write: FilePen,
  Bash: SquareTerminal,
  Glob: FolderSearch,
  Grep: FileSearch,
  Task: Workflow,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function relativeTo(value: string, cwd: string | null): string {
  if (cwd === null) return value;
  const prefix = cwd.endsWith("/") ? cwd : `${cwd}/`;
  return value.startsWith(prefix) ? value.slice(prefix.length) : value;
}

export function toolSummary(input: unknown, cwd: string | null = null): string {
  if (!isRecord(input)) return "";
  for (const key of ["file_path", "command", "pattern", "path", "description", "prompt"]) {
    const value = input[key];
    if (typeof value === "string" && value.length > 0) return relativeTo(value, cwd);
  }
  return typeof input.preview === "string" ? "input truncated" : "";
}

function Collapsible({
  header,
  children,
  defaultOpen = false,
  className,
}: {
  header: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={cn("rounded-lg border border-border bg-surface-1/70", className)}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs"
        aria-expanded={open}
      >
        <motion.span animate={{ rotate: open ? 90 : 0 }} className="text-muted-foreground">
          <ChevronRight className="size-3.5" />
        </motion.span>
        {header}
      </button>
      {open ? <div className="border-t border-border px-3 py-2">{children}</div> : null}
    </div>
  );
}

function ToolResult({ result }: { result: ToolResultView }) {
  return (
    <pre
      className={cn(
        "scrollbar-thin max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-md p-2 font-mono text-[11px] leading-relaxed",
        result.isError
          ? "bg-destructive/10 text-destructive"
          : "bg-surface-0/70 text-muted-foreground",
      )}
    >
      {result.content || "(empty)"}
      {result.truncated ? "\n…" : ""}
    </pre>
  );
}

function ToolEntry({
  entry,
  cwd,
}: {
  entry: Extract<FeedEntry, { kind: "tool" }>;
  cwd: string | null;
}) {
  const Icon = TOOL_ICONS[entry.name] ?? Wrench;
  const summary = toolSummary(entry.input, cwd);
  const state = entry.result === null ? "running" : entry.result.isError ? "error" : "ok";
  return (
    <Collapsible
      className={cn(entry.nested && "ml-6")}
      header={
        <>
          <Icon className="size-3.5 text-primary" />
          <span className="font-medium">{entry.name}</span>
          <span className="min-w-0 flex-1 truncate font-mono text-muted-foreground">{summary}</span>
          {state === "running" ? (
            <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
          ) : null}
          {state === "ok" ? <CheckCircle2 className="size-3.5 text-success" /> : null}
          {state === "error" ? <XCircle className="size-3.5 text-destructive" /> : null}
        </>
      }
    >
      <div className="space-y-2">
        <pre className="scrollbar-thin max-h-56 overflow-auto rounded-md bg-surface-0/70 p-2 font-mono text-[11px] text-muted-foreground">
          {JSON.stringify(entry.input, null, 2)}
        </pre>
        {entry.result ? <ToolResult result={entry.result} /> : null}
      </div>
    </Collapsible>
  );
}

function Bubble({
  icon,
  label,
  children,
  tone = "default",
  nested = false,
}: {
  icon: ReactNode;
  label: string;
  children: ReactNode;
  tone?: "default" | "operator" | "muted";
  nested?: boolean;
}) {
  return (
    <div className={cn("flex gap-3", nested && "ml-6")}>
      <div
        className={cn(
          "mt-0.5 grid size-7 shrink-0 place-items-center rounded-full border",
          tone === "operator"
            ? "border-primary/40 bg-primary/15 text-primary"
            : "border-border bg-surface-2 text-muted-foreground",
        )}
      >
        {icon}
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </p>
        <div
          className={cn(
            "whitespace-pre-wrap break-words text-sm leading-relaxed",
            tone === "muted" && "text-muted-foreground",
          )}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

export function FeedEntryView({ entry, cwd }: { entry: FeedEntry; cwd: string | null }) {
  switch (entry.kind) {
    case "prompt":
      return (
        <Bubble icon={<User className="size-3.5" />} label="Operator" tone="operator">
          {entry.text}
        </Bubble>
      );
    case "init":
      return (
        <p className="text-center text-[11px] text-muted-foreground">
          Session <span className="font-mono">{entry.sessionId.slice(0, 8)}</span> · {entry.model} ·{" "}
          {entry.tools.length} tools
        </p>
      );
    case "text":
      return (
        <Bubble icon={<Sparkles className="size-3.5" />} label="Claude" nested={entry.nested}>
          {entry.text}
        </Bubble>
      );
    case "thinking":
      return (
        <Collapsible
          className={cn(entry.nested && "ml-6")}
          header={
            <>
              <Brain className="size-3.5 text-muted-foreground" />
              <span className="text-muted-foreground">Thinking</span>
            </>
          }
        >
          <p className="whitespace-pre-wrap text-xs italic text-muted-foreground">{entry.text}</p>
        </Collapsible>
      );
    case "tool":
      return <ToolEntry entry={entry} cwd={cwd} />;
    case "user":
      return (
        <Bubble
          icon={<User className="size-3.5" />}
          label="Input"
          tone="muted"
          nested={entry.nested}
        >
          {entry.text}
        </Bubble>
      );
    case "status":
      return (
        <div className="flex items-center gap-3 py-1">
          <span className="h-px flex-1 bg-border" />
          <RunStatusBadge status={entry.status} />
          {entry.message ? (
            <span className="text-xs text-muted-foreground">{entry.message}</span>
          ) : null}
          <span className="h-px flex-1 bg-border" />
        </div>
      );
    case "stderr":
      return (
        <Collapsible
          header={
            <>
              <AlertTriangle className="size-3.5 text-warning" />
              <span className="text-warning">stderr</span>
              <span className="min-w-0 flex-1 truncate font-mono text-muted-foreground">
                {entry.text.trim()}
              </span>
            </>
          }
        >
          <pre className="scrollbar-thin max-h-56 overflow-auto whitespace-pre-wrap font-mono text-[11px] text-warning">
            {entry.text}
          </pre>
        </Collapsible>
      );
    case "result":
      return (
        <div
          className={cn(
            "rounded-xl border p-4",
            entry.item.isError
              ? "border-destructive/40 bg-destructive/8"
              : "border-success/40 bg-success/8",
          )}
        >
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span
              className={cn(
                "font-semibold",
                entry.item.isError ? "text-destructive" : "text-success",
              )}
            >
              {entry.item.subtype}
            </span>
            <span>{entry.item.numTurns ?? "?"} turns</span>
            <span>{formatDuration(entry.item.durationMs)}</span>
            <span>{formatUsd(entry.item.costUsd)}</span>
          </div>
          {entry.item.resultText ? (
            <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">
              {entry.item.resultText}
            </p>
          ) : null}
        </div>
      );
    case "system":
      return (
        <p className="text-center text-[11px] text-muted-foreground">system · {entry.subtype}</p>
      );
  }
}
