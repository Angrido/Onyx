"use client";

import type { SurgeonFile } from "@onyx/contracts";
import type { Suggestion } from "@onyx/ignore-compiler/browser";
import { AlertTriangle, Lightbulb, Lock, Plus, ShieldCheck, X } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/form-controls";
import { formatPercent, formatTokens, formatUsd } from "@/lib/format";
import {
  ruleLabel,
  usdFor,
  type CentralWarning,
  type Evaluation,
  type PolicyDiff,
  type PolicyRule,
} from "@/lib/surgeon";
import { cn } from "@/lib/utils";

function Panel({
  title,
  icon,
  action,
  children,
  className,
}: {
  title: string;
  icon: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn("space-y-3 p-4", className)}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
          <span className="text-primary">{icon}</span>
          {title}
        </h2>
        {action}
      </div>
      {children}
    </Card>
  );
}

const SOURCE_TONES = {
  PRESET: "neutral",
  HEURISTIC: "primary",
  MANUAL: "success",
  SECURITY: "danger",
} as const;

function SourceBadge({ rule }: { rule: PolicyRule }) {
  return (
    <Badge tone={SOURCE_TONES[rule.source]} className="px-1.5 py-0 text-[9px] uppercase">
      {rule.source.toLowerCase()}
    </Badge>
  );
}

function FileList({ files, tone }: { files: readonly SurgeonFile[]; tone: "add" | "remove" }) {
  const shown = files.slice(0, 40);
  return (
    <ul className="scrollbar-thin max-h-40 space-y-0.5 overflow-y-auto">
      {shown.map((file) => (
        <li key={file.path} className="flex items-center gap-2 text-[11px]">
          <span className={tone === "add" ? "text-success" : "text-warning"}>
            {tone === "add" ? "+" : "−"}
          </span>
          <span className="min-w-0 flex-1 truncate font-mono">{file.path}</span>
          <span className="font-mono text-muted-foreground">{formatTokens(file.rawTokens)}</span>
        </li>
      ))}
      {files.length > shown.length ? (
        <li className="text-[11px] text-muted-foreground">… {files.length - shown.length} more</li>
      ) : null}
    </ul>
  );
}

export function ImpactPanel({
  draft,
  saved,
  diff,
  warnings,
  pricing,
}: {
  draft: Evaluation;
  saved: Evaluation;
  diff: PolicyDiff;
  warnings: readonly CentralWarning[];
  pricing: { modelId: string; inputUsdPerMTok: number } | null;
}) {
  const share = draft.totalTokens > 0 ? draft.excludedTokens / draft.totalTokens : 0;
  const changed = diff.newlyExcluded.length + diff.newlyIncluded.length;
  const delta = diff.tokenDelta;
  const savedUsd = usdFor(draft.excludedTokens, pricing?.inputUsdPerMTok);
  const deltaUsd = usdFor(Math.abs(delta), pricing?.inputUsdPerMTok);
  return (
    <Panel title="Savings" icon={<ShieldCheck className="size-4" />}>
      <div className="space-y-2" data-testid="surgeon-savings">
        <div className="flex items-baseline justify-between gap-2">
          <span className="font-mono text-2xl font-semibold text-success">
            {formatTokens(draft.excludedTokens)}
          </span>
          <span className="text-xs text-muted-foreground">
            tokens kept out · {formatPercent(share)}
          </span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-surface-2">
          <div className="h-full rounded-full bg-success" style={{ width: `${share * 100}%` }} />
        </div>
        <p className="text-[11px] text-muted-foreground">
          {formatTokens(draft.totalTokens - draft.excludedTokens)} of{" "}
          {formatTokens(draft.totalTokens)} tokens stay visible to agents
          {savedUsd !== null && pricing
            ? ` · ${formatUsd(savedUsd)} of ${pricing.modelId} input per full read avoided`
            : ""}
          .
        </p>
      </div>
      <div className="rounded-lg border border-border bg-surface-0/50 p-3">
        {changed === 0 ? (
          <p className="text-xs text-muted-foreground">
            No changes against the saved profile ({formatTokens(saved.excludedTokens)} excluded).
          </p>
        ) : (
          <div className="space-y-2" data-testid="surgeon-diff">
            <p className="text-xs">
              <span className={cn("font-semibold", delta >= 0 ? "text-success" : "text-warning")}>
                {delta >= 0 ? "−" : "+"}
                {formatTokens(Math.abs(delta))} tokens
              </span>
              {deltaUsd !== null ? (
                <span className="text-muted-foreground"> ({formatUsd(deltaUsd)})</span>
              ) : null}
              <span className="text-muted-foreground">
                {" "}
                vs saved · {diff.newlyExcluded.length} excluded, {diff.newlyIncluded.length}{" "}
                restored
              </span>
            </p>
            {diff.newlyExcluded.length > 0 ? (
              <FileList files={diff.newlyExcluded} tone="remove" />
            ) : null}
            {diff.newlyIncluded.length > 0 ? (
              <FileList files={diff.newlyIncluded} tone="add" />
            ) : null}
          </div>
        )}
      </div>
      {warnings.length > 0 ? (
        <div
          className="space-y-1.5 rounded-lg border border-warning/40 bg-warning/8 p-3"
          data-testid="surgeon-central-warning"
        >
          <p className="flex items-center gap-1.5 text-xs font-medium text-warning">
            <AlertTriangle className="size-3.5" />
            {warnings.length} central {warnings.length === 1 ? "file is" : "files are"} out of
            context
          </p>
          <p className="text-[11px] text-muted-foreground">
            Many files import these; agents will only see them through the onyx MCP tools.
          </p>
          <ul className="space-y-0.5">
            {warnings.slice(0, 8).map((warning) => (
              <li key={warning.file.path} className="flex items-center gap-2 text-[11px]">
                <span className="min-w-0 flex-1 truncate font-mono">{warning.file.path}</span>
                {warning.isNew ? (
                  <Badge tone="warning" className="px-1.5 py-0 text-[9px]">
                    new
                  </Badge>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Panel>
  );
}

function RuleRow({
  rule,
  impact,
  onRemove,
}: {
  rule: PolicyRule;
  impact: { files: number; tokens: number } | undefined;
  onRemove?: (() => void) | undefined;
}) {
  return (
    <li className="group flex items-center gap-2 rounded-md px-2 py-1 hover:bg-surface-2/60">
      {rule.locked ? <Lock className="size-3 shrink-0 text-muted-foreground" /> : null}
      <span
        className={cn(
          "min-w-0 flex-1 truncate font-mono text-[11px]",
          rule.action === "INCLUDE" && "text-success",
        )}
        title={rule.reason ?? undefined}
      >
        {ruleLabel(rule)}
      </span>
      <SourceBadge rule={rule} />
      <span className="w-20 shrink-0 text-right font-mono text-[10px] text-muted-foreground">
        {impact
          ? `${impact.files} · ${formatTokens(impact.tokens)}`
          : rule.action === "INCLUDE"
            ? "keeps"
            : "—"}
      </span>
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove rule ${ruleLabel(rule)}`}
          className="rounded p-0.5 text-muted-foreground opacity-60 hover:bg-surface-3 hover:text-foreground group-hover:opacity-100"
        >
          <X className="size-3" />
        </button>
      ) : null}
    </li>
  );
}

export function RulesPanel({
  layerLabel,
  rules,
  inherited,
  security,
  impact,
  onAdd,
  onRemove,
}: {
  layerLabel: string;
  rules: readonly PolicyRule[];
  inherited: readonly PolicyRule[];
  security: readonly PolicyRule[];
  impact: Evaluation["byRule"];
  onAdd: (raw: string) => boolean;
  onRemove: (index: number) => void;
}) {
  const [value, setValue] = useState("");
  const [showInherited, setShowInherited] = useState(false);
  const listRef = useRef<HTMLUListElement>(null);
  const previousCount = useRef(rules.length);
  useEffect(() => {
    const list = listRef.current;
    if (list && rules.length > previousCount.current) list.scrollTop = list.scrollHeight;
    previousCount.current = rules.length;
  }, [rules.length]);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (onAdd(value)) setValue("");
  };
  return (
    <Panel
      title="Rules"
      icon={<Lock className="size-4" />}
      action={<span className="text-[11px] text-muted-foreground">{layerLabel}</span>}
    >
      <form onSubmit={submit} className="flex gap-2">
        <Input
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="e.g. fixtures/ or !dist/keep.js"
          aria-label="New rule"
          className="h-8 font-mono text-xs"
        />
        <Button type="submit" size="sm" variant="secondary" disabled={value.trim().length === 0}>
          <Plus />
          Add
        </Button>
      </form>
      <p className="text-[11px] text-muted-foreground">
        .gitignore syntax: later rules win, <span className="font-mono">!</span> brings files back.
      </p>
      {rules.length === 0 ? (
        <p className="text-xs text-muted-foreground">No rules in this layer yet.</p>
      ) : (
        <ul
          ref={listRef}
          className="scrollbar-thin max-h-72 space-y-0.5 overflow-y-auto"
          data-testid="surgeon-rules"
        >
          {rules.map((rule, index) => (
            <RuleRow
              key={`${ruleLabel(rule)}:${index}`}
              rule={rule}
              impact={impact.get(rule)}
              onRemove={() => onRemove(index)}
            />
          ))}
        </ul>
      )}
      {inherited.length > 0 ? (
        <div className="space-y-1">
          <button
            type="button"
            className="text-[11px] font-medium text-muted-foreground hover:text-foreground"
            onClick={() => setShowInherited((current) => !current)}
          >
            {showInherited ? "Hide" : "Show"} {inherited.length} rules inherited from the project
          </button>
          {showInherited ? (
            <ul className="space-y-0.5 opacity-80">
              {inherited.map((rule, index) => (
                <RuleRow
                  key={`${ruleLabel(rule)}:${index}`}
                  rule={rule}
                  impact={impact.get(rule)}
                />
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      <div className="space-y-1 border-t border-border pt-2">
        <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          Always excluded
        </p>
        <ul className="space-y-0.5">
          {security.map((rule) => (
            <RuleRow key={rule.pattern} rule={rule} impact={impact.get(rule)} />
          ))}
        </ul>
      </div>
    </Panel>
  );
}

export function SuggestionsPanel({
  suggestions,
  onApply,
}: {
  suggestions: readonly Suggestion[];
  onApply: (suggestion: Suggestion) => void;
}) {
  return (
    <Panel title="Suggestions" icon={<Lightbulb className="size-4" />}>
      {suggestions.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Nothing obvious left to cut: presets, binary assets, large data files and generated code
          are already out.
        </p>
      ) : (
        <ul className="space-y-1.5" data-testid="surgeon-suggestions">
          {suggestions.slice(0, 8).map((suggestion) => (
            <li
              key={suggestion.rule.pattern}
              className="flex items-center gap-2 rounded-lg border border-border bg-surface-0/50 px-2.5 py-2"
            >
              <div className="min-w-0 flex-1 space-y-0.5">
                <p className="truncate font-mono text-[11px]">{suggestion.rule.pattern}</p>
                <p className="truncate text-[10px] text-muted-foreground">
                  {suggestion.rule.reason ?? "Preset"} · {suggestion.files} files ·{" "}
                  {suggestion.tokens > 0
                    ? `${formatTokens(suggestion.tokens)} tokens`
                    : "kept out of image reads"}
                  {suggestion.centralFiles.length > 0
                    ? ` · ${suggestion.centralFiles.length} central`
                    : ""}
                </p>
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => onApply(suggestion)}
                aria-label={`Apply ${suggestion.rule.pattern}`}
              >
                <Plus />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
