"use client";

import type {
  ContextEntry,
  ContextItem,
  ContextRole,
  RoutingItem,
  SessionItem,
} from "@onyx/contracts";
import {
  AlertTriangle,
  Boxes,
  Brain,
  CheckCircle2,
  ChevronRight,
  FilePen,
  FileSearch,
  FileText,
  FolderSearch,
  GitBranch,
  Layers3,
  Loader2,
  Route,
  ShieldX,
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
import { contextSavings, type FeedEntry, type ToolResultView } from "@/lib/run-feed";
import {
  formatDuration,
  formatPercent,
  formatSaving,
  formatTokens,
  formatUsd,
  shortId,
} from "@/lib/format";
import { END_REASON_LABELS, ROUTING_STRATEGY_LABELS } from "@/lib/sessions";
import { TIER_STYLES, modelLabel } from "@/lib/tiers";
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

const ONYX_TOOL_PREFIX = "mcp__onyx__";

function toolLabel(name: string): string {
  return name.startsWith(ONYX_TOOL_PREFIX) ? `onyx · ${name.slice(ONYX_TOOL_PREFIX.length)}` : name;
}

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
  const handle = input.handle;
  if (typeof handle === "string" && handle.length > 0) return `#${handle.replace(/^#/, "")}`;
  for (const key of ["file_path", "command", "pattern", "path", "query", "description", "prompt"]) {
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
  const Icon = entry.name.startsWith(ONYX_TOOL_PREFIX) ? Boxes : (TOOL_ICONS[entry.name] ?? Wrench);
  const summary = toolSummary(entry.input, cwd);
  const state = entry.result === null ? "running" : entry.result.isError ? "error" : "ok";
  return (
    <Collapsible
      className={cn(entry.nested && "ml-6")}
      header={
        <>
          <Icon className="size-3.5 text-primary" />
          <span className="font-medium">{toolLabel(entry.name)}</span>
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

const LEVEL_LABELS = ["map", "signatures", "contracts", "full"] as const;

const ROLE_TITLES: Record<ContextRole, string> = {
  target: "Targets",
  dependency: "Dependencies",
  dependent: "Dependents",
  nearby: "Nearby",
};

function LevelBadge({ level }: { level: ContextEntry["level"] }) {
  return (
    <span
      className={cn(
        "rounded px-1.5 py-0.5 font-mono text-[10px]",
        level === 3 && "bg-primary/15 text-primary",
        level === 2 && "bg-info/15 text-info",
        level === 1 && "bg-surface-3 text-foreground",
        level === 0 && "bg-surface-2 text-muted-foreground",
      )}
      title={LEVEL_LABELS[level]}
    >
      L{level}
    </span>
  );
}

function ContextView({ item }: { item: ContextItem }) {
  const savings = contextSavings(item);
  const roles = (Object.keys(ROLE_TITLES) as ContextRole[]).filter((role) =>
    item.entries.some((entry) => entry.role === role),
  );
  return (
    <Collapsible
      header={
        <>
          <Layers3 className="size-3.5 text-primary" />
          <span className="font-medium">Onyx context</span>
          <span className="min-w-0 flex-1 truncate text-muted-foreground">
            {item.entries.length > 0
              ? `${item.entries.length} files · ${formatTokens(item.packTokens)} pack + ${formatTokens(item.mapTokens)} map`
              : (item.note ?? `${formatTokens(item.mapTokens)} map`)}
          </span>
          {savings !== null ? (
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[10px] font-semibold",
                savings >= 0 ? "bg-success/15 text-success" : "bg-warning/15 text-warning",
              )}
            >
              {formatSaving(savings)} vs full reads
            </span>
          ) : null}
          {item.mcpEnabled ? (
            <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[10px] text-muted-foreground">
              MCP
            </span>
          ) : null}
        </>
      }
    >
      <div className="space-y-3 text-xs">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            ["Delivered", formatTokens(item.deliveredTokens)],
            ["Full reads", item.baselineTokens > 0 ? formatTokens(item.baselineTokens) : "—"],
            ["Context pack", formatTokens(item.packTokens)],
            ["Project map", formatTokens(item.mapTokens)],
          ].map(([label, value]) => (
            <div key={label} className="rounded-md bg-surface-0/70 px-2 py-1.5">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
              <p className="font-mono text-sm">{value}</p>
            </div>
          ))}
        </div>
        {item.note ? <p className="text-muted-foreground">{item.note}</p> : null}
        {roles.map((role) => (
          <div key={role} className="space-y-1">
            <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              {ROLE_TITLES[role]}
            </p>
            <ul className="space-y-0.5">
              {item.entries
                .filter((entry) => entry.role === role)
                .map((entry) => (
                  <li key={entry.relPath} className="flex items-center gap-2">
                    <LevelBadge level={entry.level} />
                    <span className="min-w-0 flex-1 truncate font-mono">
                      {entry.relPath}
                      {entry.symbols ? (
                        <span className="text-muted-foreground"> · {entry.symbols.join(", ")}</span>
                      ) : null}
                      {item.inferredTargets.includes(entry.relPath) ? (
                        <span className="text-muted-foreground"> · from prompt</span>
                      ) : null}
                    </span>
                    <span className="font-mono text-muted-foreground">
                      {formatTokens(entry.tokens)}
                    </span>
                  </li>
                ))}
            </ul>
          </div>
        ))}
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

function GuardEntry({
  entry,
  cwd,
}: {
  entry: Extract<FeedEntry, { kind: "guard" }>;
  cwd: string | null;
}) {
  const { item } = entry;
  return (
    <div
      className="flex items-center gap-2 rounded-lg border border-warning/40 bg-warning/8 px-3 py-2 text-xs"
      title={item.reason ?? undefined}
      data-testid="guard-entry"
    >
      <ShieldX className="size-3.5 shrink-0 text-warning" />
      <span className="font-medium text-warning">Blocked</span>
      <span className="font-medium">{toolLabel(item.tool)}</span>
      <span className="min-w-0 flex-1 truncate font-mono text-muted-foreground">
        {item.target ? relativeTo(item.target, cwd) : "—"}
      </span>
      {item.rule ? (
        <span className="shrink-0 rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
          {item.rule}
        </span>
      ) : null}
      <span className="shrink-0 text-[10px] uppercase tracking-wider text-muted-foreground">
        {item.source === "hook" ? "context guard" : "permission rule"}
      </span>
    </div>
  );
}

function RoutingEntry({ item }: { item: RoutingItem }) {
  const tier = TIER_STYLES[item.tier];
  return (
    <div
      className={cn("rounded-lg border px-3 py-2 text-xs", tier.border, tier.bg)}
      data-testid="routing-entry"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Route className={cn("size-3.5", tier.text)} />
        <span className={cn("font-semibold", tier.text)}>{tier.label}</span>
        <span className="font-medium">{modelLabel(item.modelId)}</span>
        <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
          {ROUTING_STRATEGY_LABELS[item.strategy]}
          {item.ruleName ? ` · ${item.ruleName}` : ""}
        </span>
        {item.score !== null ? (
          <span className="font-mono text-[10px] text-muted-foreground">
            score {item.score.toFixed(2)}
            {item.confidence !== null ? ` · confidence ${formatPercent(item.confidence)}` : ""}
          </span>
        ) : null}
      </div>
      <p className="mt-1 text-muted-foreground">{item.rationale}</p>
    </div>
  );
}

function SessionEntry({ item }: { item: SessionItem }) {
  const title =
    item.action === "resumed"
      ? `Resumed session ${shortId(item.sessionId)}`
      : `New session ${shortId(item.sessionId)}`;
  const detail = [
    item.workspaceName,
    item.reason ? END_REASON_LABELS[item.reason] : null,
    item.action === "resumed"
      ? `${formatTokens(item.contextTokens)} / ${formatTokens(item.maxSessionTokens)} context`
      : null,
  ]
    .filter((part): part is string => part !== null)
    .join(" · ");
  const header = (
    <>
      <GitBranch className="size-3.5 text-info" />
      <span className="font-medium">{title}</span>
      <span className="min-w-0 flex-1 truncate text-muted-foreground">{detail}</span>
      {item.handoff ? (
        <span className="rounded-full bg-info/15 px-2 py-0.5 text-[10px] font-semibold text-info">
          handoff · {formatTokens(item.handoff.tokens)}
        </span>
      ) : null}
    </>
  );
  if (!item.handoff) {
    return (
      <div
        className="flex items-center gap-2 rounded-lg border border-border bg-surface-1/70 px-3 py-2 text-xs"
        data-testid="session-entry"
      >
        {header}
      </div>
    );
  }
  return (
    <div data-testid="session-entry">
      <Collapsible header={header}>
        <pre className="scrollbar-thin max-h-72 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-muted-foreground">
          {item.handoff.text}
        </pre>
      </Collapsible>
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
          Claude session <span className="font-mono">{shortId(entry.sessionId)}</span> ·{" "}
          {entry.model} · {entry.tools.length} tools
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
          {entry.item.errors && entry.item.errors.length > 0 ? (
            <ul className="mt-2 space-y-1" data-testid="result-errors">
              {entry.item.errors.map((error, index) => (
                <li key={index} className="whitespace-pre-wrap font-mono text-xs text-destructive">
                  {error}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      );
    case "system":
      return (
        <p className="text-center text-[11px] text-muted-foreground">system · {entry.subtype}</p>
      );
    case "context":
      return <ContextView item={entry.item} />;
    case "guard":
      return <GuardEntry entry={entry} cwd={cwd} />;
    case "routing":
      return <RoutingEntry item={entry.item} />;
    case "session":
      return <SessionEntry item={entry.item} />;
  }
}
