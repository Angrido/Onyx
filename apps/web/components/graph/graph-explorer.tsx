"use client";

import type { Domain, GraphResponse } from "@onyx/contracts";
import { useQuery } from "@tanstack/react-query";
import { Maximize2, Network, RefreshCcw } from "lucide-react";
import dynamic from "next/dynamic";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { FilePanel } from "@/components/graph/file-panel";
import type { CanvasLink, CanvasNode } from "@/components/graph/force-canvas";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/form-controls";
import { EmptyState, Skeleton } from "@/components/ui/skeleton";
import { api, errorMessage } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/keys";
import { DOMAIN_COLORS, DOMAIN_LABELS, domainColor } from "@/lib/domains";
import { useT } from "@/lib/i18n/client";

const ForceCanvas = dynamic(() => import("@/components/graph/force-canvas"), {
  ssr: false,
  loading: () => <Skeleton className="size-full" />,
});

const MIN_RADIUS = 2.5;
const MAX_EXTRA_RADIUS = 14;

function useElementSize<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      setSize({
        width: Math.floor(entry.contentRect.width),
        height: Math.floor(entry.contentRect.height),
      });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return { ref, ...size };
}

function dependentsOf(graph: GraphResponse, start: string): Set<string> {
  const incoming = new Map<string, string[]>();
  for (const edge of graph.edges) {
    const list = incoming.get(edge.to) ?? [];
    list.push(edge.from);
    incoming.set(edge.to, list);
  }
  const reached = new Set([start]);
  const queue = [start];
  while (queue.length > 0) {
    const node = queue.shift() ?? "";
    for (const parent of incoming.get(node) ?? []) {
      if (reached.has(parent)) continue;
      reached.add(parent);
      queue.push(parent);
    }
  }
  return reached;
}

export function GraphExplorer({ projectId }: { projectId: string }) {
  const t = useT();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const focus = searchParams.get("focus");
  const depth = Number(searchParams.get("depth") ?? "2");
  const [selected, setSelected] = useState<string | null>(focus);
  const [search, setSearch] = useState(focus ?? "");
  const [showUnlinked, setShowUnlinked] = useState(false);
  const { ref, width, height } = useElementSize<HTMLDivElement>();

  const navigate = (nextFocus: string | null, nextDepth = depth) => {
    const params = new URLSearchParams();
    if (nextFocus) params.set("focus", nextFocus);
    if (nextFocus && nextDepth !== 2) params.set("depth", String(nextDepth));
    router.replace(params.size > 0 ? `${pathname}?${params.toString()}` : pathname);
    setSearch(nextFocus ?? "");
    if (nextFocus) setSelected(nextFocus);
  };

  const { data, isPending, error, refetch, isFetching } = useQuery({
    queryKey: queryKeys.graph(projectId, focus, depth),
    queryFn: () => {
      const params = new URLSearchParams({ depth: String(depth) });
      if (focus) params.set("focus", focus);
      return api.get<GraphResponse>(`/api/projects/${projectId}/graph?${params.toString()}`);
    },
  });

  const blast = useMemo(
    () => (data && selected ? dependentsOf(data, selected) : null),
    [data, selected],
  );

  const canvas = useMemo(() => {
    if (!data) return { nodes: [] as CanvasNode[], links: [] as CanvasLink[], hidden: 0 };
    const visible = data.nodes.filter(
      (node) =>
        showUnlinked ||
        node.inDegree + node.outDegree > 0 ||
        node.id === selected ||
        node.id === data.focus,
    );
    const maxCentrality = Math.max(...visible.map((node) => node.centrality), 1e-9);
    const nodes: CanvasNode[] = visible.map((node) => ({
      id: node.id,
      label: node.id.slice(node.id.lastIndexOf("/") + 1),
      color: domainColor(node.domain),
      radius: MIN_RADIUS + MAX_EXTRA_RADIUS * Math.sqrt(node.centrality / maxCentrality),
      ring:
        node.id === selected
          ? "selected"
          : node.id === data.focus
            ? "focus"
            : node.inCycle
              ? "cycle"
              : null,
      dimmed: blast !== null && !blast.has(node.id),
      emphasized: node.id === selected || node.id === data.focus || (blast?.has(node.id) ?? false),
    }));
    const shown = new Set(visible.map((node) => node.id));
    const links: CanvasLink[] = data.edges
      .filter((edge) => shown.has(edge.from) && shown.has(edge.to))
      .map((edge) => ({
        source: edge.from,
        target: edge.to,
        typeOnly: edge.kind === "TYPE_ONLY",
        emphasized: blast !== null && blast.has(edge.from) && blast.has(edge.to),
      }));
    return { nodes, links, hidden: data.nodes.length - visible.length };
  }, [data, selected, blast, showUnlinked]);

  const nodeIds = useMemo(() => (data ? data.nodes.map((node) => node.id).sort() : []), [data]);
  const domainsPresent = useMemo(
    () =>
      [...new Set((data?.nodes ?? []).map((node) => node.domain))].sort((a, b) =>
        String(a).localeCompare(String(b)),
      ),
    [data],
  );

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = search.trim();
    navigate(value.length > 0 ? value : null);
  }

  if (error) {
    return (
      <EmptyState
        icon={<Network className="size-5" />}
        title={t("Graph unavailable")}
        description={errorMessage(error)}
      />
    );
  }

  return (
    <div className="grid min-h-0 gap-4 lg:grid-cols-[minmax(0,1fr)_24rem]">
      <div className="flex min-h-0 flex-col gap-3">
        <form onSubmit={submitSearch} className="flex flex-wrap items-center gap-2">
          <Input
            list="graph-files"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t("Focus on a file, e.g. src/index.ts")}
            className="min-w-56 flex-1 font-mono text-xs"
            aria-label={t("Focus file")}
          />
          <datalist id="graph-files">
            {nodeIds.map((id) => (
              <option key={id} value={id} />
            ))}
          </datalist>
          <Select
            value={String(depth)}
            onChange={(event) => navigate(focus, Number(event.target.value))}
            disabled={!focus}
            aria-label={t("Depth")}
            className="w-28"
          >
            {[1, 2, 3, 4].map((value) => (
              <option key={value} value={value}>
                {t("depth {value}", { value })}
              </option>
            ))}
          </Select>
          <Button type="submit" variant="secondary" size="sm">
            {t("Focus")}
          </Button>
          <label className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
            <input
              type="checkbox"
              className="size-3.5 accent-[var(--primary)]"
              checked={showUnlinked}
              onChange={(event) => setShowUnlinked(event.target.checked)}
            />
            {t("Unlinked files")}
          </label>
          <Button type="button" variant="ghost" size="sm" onClick={() => navigate(null)}>
            <Maximize2 />
            {t("Whole project")}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => void refetch()}
            title={t("Reload")}
          >
            <RefreshCcw className={isFetching ? "animate-spin" : undefined} />
          </Button>
        </form>

        <Card className="relative h-[62vh] min-h-80 overflow-hidden p-0">
          <div ref={ref} className="absolute inset-0">
            {isPending || width === 0 ? (
              <Skeleton className="size-full rounded-none" />
            ) : (
              <ForceCanvas
                nodes={canvas.nodes}
                links={canvas.links}
                width={width}
                height={height}
                dimLinks={blast !== null}
                onSelect={setSelected}
                onFocus={(id) => navigate(id)}
              />
            )}
          </div>
          {data ? (
            <div className="pointer-events-none absolute bottom-3 left-3 flex flex-wrap gap-3 rounded-lg bg-surface-0/80 px-3 py-2 text-[11px] text-muted-foreground backdrop-blur">
              {domainsPresent.map((domain) => (
                <span key={domain ?? "shared"} className="flex items-center gap-1.5">
                  <span
                    className="size-2 rounded-full"
                    style={{
                      backgroundColor: DOMAIN_COLORS[(domain ?? "SHARED") as Domain | "SHARED"],
                    }}
                  />
                  {domain ? t(DOMAIN_LABELS[domain]) : t("Shared")}
                </span>
              ))}
              <span>{t("· size = centrality · dashed = type-only · red ring = cycle")}</span>
            </div>
          ) : null}
        </Card>

        {data ? (
          <p className="text-xs text-muted-foreground">
            {t("{files} files, {imports} imports", {
              files: data.nodes.length,
              imports: data.edges.length,
            })}
            {data.truncated ? ` ${t("(most central of {total})", { total: data.totalNodes })}` : ""}
            {canvas.hidden > 0
              ? ` · ${t("{count} unlinked files hidden", { count: canvas.hidden })}`
              : ""}
            {data.cycles.length > 0
              ? ` · ${t("{count} import cycles", { count: data.cycles.length })}`
              : ""}
            {blast && selected
              ? ` · ${t("{count} files depend on {file}", {
                  count: blast.size - 1,
                  file: selected.slice(selected.lastIndexOf("/") + 1),
                })}`
              : ` · ${t("click a file to see its blast radius, double-click to focus")}`}
          </p>
        ) : null}
      </div>

      <div className="min-h-0 space-y-4">
        {selected ? (
          <FilePanel
            key={selected}
            projectId={projectId}
            path={selected}
            onSelect={setSelected}
            onFocus={(path) => navigate(path)}
            onClose={() => setSelected(null)}
          />
        ) : (
          <Card className="space-y-3 p-4 text-xs text-muted-foreground">
            <p className="text-sm font-medium text-foreground">{t("Most used externals")}</p>
            <ul className="space-y-1">
              {(data?.externalModules ?? []).slice(0, 12).map((module) => (
                <li key={module.name} className="flex justify-between gap-3 font-mono">
                  <span className="truncate">{module.name}</span>
                  <span>{module.importers}</span>
                </li>
              ))}
            </ul>
            {data && Object.keys(data.proposedWorkspaceGlobs).length > 0 ? (
              <>
                <p className="pt-2 text-sm font-medium text-foreground">
                  {t("Suggested workspace globs")}
                </p>
                <ul className="space-y-1">
                  {Object.entries(data.proposedWorkspaceGlobs).map(([domain, globs]) => (
                    <li key={domain}>
                      <span className="text-foreground">
                        {t(DOMAIN_LABELS[domain as Domain] ?? domain)}
                      </span>{" "}
                      <span className="font-mono">{globs.join(", ")}</span>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </Card>
        )}
      </div>
    </div>
  );
}
