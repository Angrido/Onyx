"use client";

import type { SurgeonFile } from "@onyx/contracts";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ArrowDownWideNarrow,
  ArrowDownAZ,
  Check,
  ChevronRight,
  File,
  FileLock2,
  Folder,
  FolderOpen,
  Lock,
  Minus,
  Search,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/form-controls";
import { DOMAIN_LABELS } from "@/lib/domains";
import { formatTokens } from "@/lib/format";
import {
  buildTree,
  directoryState,
  EMPTY_FILTER,
  extensionOf,
  filterFiles,
  flattenTree,
  heatColor,
  heatOf,
  isFiltering,
  ruleLabel,
  type DirectoryStats,
  type DomainFilter,
  type Evaluation,
  type SelectionState,
  type StateFilter,
  type TreeFilter,
  type TreeNode,
  type TreeSort,
} from "@/lib/surgeon";
import { cn } from "@/lib/utils";

const ROW_HEIGHT = 30;
const AUTO_EXPAND_LIMIT = 2_000;
const INDENT = 16;

function TriCheckbox({
  state,
  label,
  onToggle,
}: {
  state: SelectionState;
  label: string;
  onToggle: () => void;
}) {
  const locked = state === "locked";
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={state === "included" ? true : state === "partial" ? "mixed" : false}
      aria-label={label}
      disabled={locked}
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
      className={cn(
        "grid size-4 shrink-0 place-items-center rounded-[4px] border transition-colors",
        state === "included" && "border-primary bg-primary text-primary-foreground",
        state === "partial" && "border-primary/70 bg-primary/35 text-primary-foreground",
        state === "excluded" && "border-border-strong bg-surface-0 hover:border-primary/60",
        locked && "border-border bg-surface-2 text-muted-foreground",
      )}
    >
      {state === "included" ? <Check className="size-3" strokeWidth={3} /> : null}
      {state === "partial" ? <Minus className="size-3" strokeWidth={3} /> : null}
      {locked ? <Lock className="size-2.5" /> : null}
    </button>
  );
}

function selectionOf(
  node: TreeNode,
  draft: Evaluation,
  stats: ReadonlyMap<string, DirectoryStats>,
): SelectionState {
  if (node.directory) return directoryState(stats.get(node.path));
  if (draft.locked.has(node.path)) return "locked";
  return draft.excluded.has(node.path) ? "excluded" : "included";
}

function ChangeMark({ excluded }: { excluded: boolean }) {
  return (
    <span
      className={cn(
        "shrink-0 rounded px-1 font-mono text-[10px] font-semibold",
        excluded ? "bg-warning/15 text-warning" : "bg-success/15 text-success",
      )}
      title={excluded ? "Excluded by this draft" : "Back in context with this draft"}
    >
      {excluded ? "−" : "+"}
    </span>
  );
}

function TreeRowView({
  node,
  depth,
  expanded,
  selection,
  tokens,
  totalTokens,
  draft,
  saved,
  stats,
  onExpand,
  onToggle,
}: {
  node: TreeNode;
  depth: number;
  expanded: boolean;
  selection: SelectionState;
  tokens: number;
  totalTokens: number;
  draft: Evaluation;
  saved: Evaluation;
  stats: DirectoryStats | undefined;
  onExpand: () => void;
  onToggle: () => void;
}) {
  const file = node.file;
  const excluded = selection === "excluded" || selection === "locked";
  const rule = file ? (draft.excluded.get(file.path) ?? null) : null;
  const changed = file
    ? draft.excluded.has(file.path) !== saved.excluded.has(file.path)
    : (stats?.changed ?? 0) > 0;
  const heat = heatOf(tokens, totalTokens);
  const FolderIcon = expanded ? FolderOpen : Folder;
  return (
    <div
      className={cn(
        "group flex h-full items-center gap-2 pr-3 text-xs hover:bg-surface-2/60",
        node.directory && "cursor-pointer",
      )}
      onClick={node.directory ? onExpand : undefined}
      data-path={node.path}
    >
      <div
        className="flex min-w-0 flex-1 items-center gap-1.5"
        style={{ paddingLeft: depth * INDENT + 8 }}
      >
        {node.directory ? (
          <ChevronRight
            className={cn(
              "size-3.5 shrink-0 text-muted-foreground transition-transform",
              expanded && "rotate-90",
            )}
          />
        ) : (
          <span className="w-3.5 shrink-0" />
        )}
        <TriCheckbox
          state={selection}
          label={`${selection === "included" ? "Exclude" : "Include"} ${node.path}`}
          onToggle={onToggle}
        />
        {node.directory ? (
          <FolderIcon className="size-3.5 shrink-0 text-muted-foreground" />
        ) : file?.sensitive ? (
          <FileLock2 className="size-3.5 shrink-0 text-warning" />
        ) : (
          <File className="size-3.5 shrink-0 text-muted-foreground" />
        )}
        <span
          className={cn(
            "min-w-0 truncate",
            node.directory ? "font-medium" : "font-mono text-[11px]",
            excluded && "text-muted-foreground line-through decoration-muted-foreground/50",
          )}
          title={node.path}
        >
          {node.name}
        </span>
        {node.directory && stats ? (
          <span className="shrink-0 text-[10px] text-muted-foreground">
            {stats.files - stats.excludedFiles}/{stats.files}
          </span>
        ) : null}
        {rule ? (
          <span
            className="hidden shrink-0 truncate rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground sm:inline"
            title={`${rule.source.toLowerCase()} rule${rule.reason ? ` · ${rule.reason}` : ""}`}
          >
            {ruleLabel(rule)}
          </span>
        ) : null}
        {file?.binary ? (
          <span className="shrink-0 text-[10px] uppercase tracking-wider text-muted-foreground">
            binary
          </span>
        ) : null}
        {changed ? (
          <ChangeMark excluded={file ? draft.excluded.has(file.path) : selection !== "included"} />
        ) : null}
      </div>
      <div className="hidden h-1.5 w-20 shrink-0 overflow-hidden rounded-full bg-surface-2 sm:block">
        <div
          className="h-full rounded-full"
          style={{
            width: `${Math.max(heat * 100, tokens > 0 ? 3 : 0)}%`,
            background: heatColor(heat),
            opacity: excluded ? 0.35 : 1,
          }}
        />
      </div>
      <span
        className={cn(
          "w-14 shrink-0 text-right font-mono text-[11px] tabular-nums",
          excluded ? "text-muted-foreground" : "text-foreground",
        )}
      >
        {formatTokens(tokens)}
      </span>
    </div>
  );
}

export function FileTree({
  files,
  draft,
  saved,
  stats,
  onToggle,
}: {
  files: readonly SurgeonFile[];
  draft: Evaluation;
  saved: Evaluation;
  stats: ReadonlyMap<string, DirectoryStats>;
  onToggle: (node: TreeNode, selection: SelectionState) => void;
}) {
  const [filter, setFilter] = useState<TreeFilter>(EMPTY_FILTER);
  const [sort, setSort] = useState<TreeSort>("tokens");
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const scrollRef = useRef<HTMLDivElement>(null);

  const extensions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const file of files) {
      const extension = extensionOf(file.path);
      if (extension) counts.set(extension, (counts.get(extension) ?? 0) + 1);
    }
    return [...counts].sort((a, b) => b[1] - a[1]).map(([extension]) => extension);
  }, [files]);

  const visible = useMemo(
    () => filterFiles(files, filter, draft, saved),
    [files, filter, draft, saved],
  );
  const tree = useMemo(() => buildTree(visible), [visible]);
  const filtering = isFiltering(filter);
  const rows = useMemo(
    () =>
      flattenTree(tree, expanded, sort, stats, filtering && visible.length <= AUTO_EXPAND_LIMIT),
    [tree, expanded, sort, stats, filtering, visible.length],
  );
  const totalTokens = stats.get("")?.tokens ?? 0;

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 16,
  });

  const toggleExpanded = (path: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const expandTopLevel = () =>
    setExpanded(new Set(tree.children.filter((node) => node.directory).map((node) => node.path)));

  return (
    <Card className="flex min-w-0 flex-col self-start overflow-hidden xl:sticky xl:top-6">
      <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
        <div className="relative min-w-48 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={filter.search}
            onChange={(event) => setFilter({ ...filter, search: event.target.value })}
            placeholder="Filter by path"
            aria-label="Filter by path"
            className="h-8 pl-8 text-xs"
          />
        </div>
        <Select
          value={filter.state}
          onChange={(event) => setFilter({ ...filter, state: event.target.value as StateFilter })}
          aria-label="Filter by state"
          className="h-8 w-auto text-xs"
        >
          <option value="all">All files</option>
          <option value="included">In context</option>
          <option value="excluded">Excluded</option>
          <option value="changed">Changed</option>
        </Select>
        <Select
          value={filter.domain}
          onChange={(event) => setFilter({ ...filter, domain: event.target.value as DomainFilter })}
          aria-label="Filter by domain"
          className="h-8 w-auto text-xs"
        >
          <option value="all">All domains</option>
          {Object.entries(DOMAIN_LABELS).map(([domain, label]) => (
            <option key={domain} value={domain}>
              {label}
            </option>
          ))}
          <option value="SHARED">Shared</option>
        </Select>
        <Select
          value={filter.extension}
          onChange={(event) => setFilter({ ...filter, extension: event.target.value })}
          aria-label="Filter by extension"
          className="h-8 w-auto text-xs"
        >
          <option value="all">All types</option>
          {extensions.map((extension) => (
            <option key={extension} value={extension}>
              .{extension}
            </option>
          ))}
        </Select>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setSort(sort === "tokens" ? "name" : "tokens")}
          title={sort === "tokens" ? "Sorted by tokens" : "Sorted by name"}
        >
          {sort === "tokens" ? <ArrowDownWideNarrow /> : <ArrowDownAZ />}
          {sort === "tokens" ? "Tokens" : "Name"}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => (expanded.size > 0 ? setExpanded(new Set()) : expandTopLevel())}
        >
          {expanded.size > 0 ? "Collapse" : "Expand"}
        </Button>
      </div>
      <div className="flex items-center justify-between gap-2 px-4 py-2 text-[11px] text-muted-foreground">
        <span>
          {filtering ? `${visible.length} of ${files.length} files` : `${files.length} files`}
        </span>
        <span className="flex items-center gap-2">
          <span>fewer tokens</span>
          <span
            className="h-1.5 w-16 rounded-full"
            style={{
              background: `linear-gradient(90deg, ${heatColor(0)}, ${heatColor(0.5)}, ${heatColor(1)})`,
            }}
          />
          <span>more</span>
        </span>
      </div>
      <div
        ref={scrollRef}
        className="scrollbar-thin h-[62vh] min-h-80 overflow-y-auto border-t border-border"
        data-testid="surgeon-tree"
      >
        {rows.length === 0 ? (
          <p className="px-4 py-10 text-center text-xs text-muted-foreground">
            No files match the filters.
          </p>
        ) : (
          <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((item) => {
              const row = rows[item.index];
              if (!row) return null;
              const { node } = row;
              const selection = selectionOf(node, draft, stats);
              const tokens = node.directory
                ? (stats.get(node.path)?.tokens ?? 0)
                : (node.file?.rawTokens ?? 0);
              return (
                <div
                  key={node.path}
                  className="absolute inset-x-0 top-0"
                  style={{ height: ROW_HEIGHT, transform: `translateY(${item.start}px)` }}
                >
                  <TreeRowView
                    node={node}
                    depth={row.depth}
                    expanded={
                      node.directory &&
                      (expanded.has(node.path) ||
                        (filtering && visible.length <= AUTO_EXPAND_LIMIT))
                    }
                    selection={selection}
                    tokens={tokens}
                    totalTokens={totalTokens}
                    draft={draft}
                    saved={saved}
                    stats={node.directory ? stats.get(node.path) : undefined}
                    onExpand={() => toggleExpanded(node.path)}
                    onToggle={() => onToggle(node, selection)}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Card>
  );
}
