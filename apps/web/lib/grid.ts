import type { QueueActiveDto, TerminalDto } from "@onyx/contracts";

export type PanelSource =
  { kind: "terminal"; workspaceId: string } | { kind: "run"; runId: string };

export const GRID_STORAGE_KEY = "onyx.agent-grid";
export const MAX_PANELS = 9;

export interface GridLayout {
  count: number;
  panels: (PanelSource | null)[];
}

function isSource(value: unknown): value is PanelSource {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  if (record["kind"] === "terminal") return typeof record["workspaceId"] === "string";
  if (record["kind"] === "run") return typeof record["runId"] === "string";
  return false;
}

export function clampCount(count: number): number {
  if (!Number.isFinite(count)) return 1;
  return Math.min(MAX_PANELS, Math.max(1, Math.round(count)));
}

export function parseLayout(raw: string | null): GridLayout | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null) return null;
    const record = parsed as Record<string, unknown>;
    const panels = Array.isArray(record["panels"]) ? record["panels"] : [];
    return {
      count: clampCount(Number(record["count"])),
      panels: panels.slice(0, MAX_PANELS).map((panel) => (isSource(panel) ? panel : null)),
    };
  } catch {
    return null;
  }
}

export function sourceKey(source: PanelSource | null): string {
  if (!source) return "";
  return source.kind === "terminal" ? `terminal:${source.workspaceId}` : `run:${source.runId}`;
}

export function sourceFromKey(key: string): PanelSource | null {
  const [kind, id] = [key.slice(0, key.indexOf(":")), key.slice(key.indexOf(":") + 1)];
  if (kind === "terminal" && id) return { kind: "terminal", workspaceId: id };
  if (kind === "run" && id) return { kind: "run", runId: id };
  return null;
}

export function defaultPanels(
  count: number,
  runs: readonly Pick<QueueActiveDto, "runId">[],
  terminals: readonly Pick<TerminalDto, "workspaceId" | "state">[],
): (PanelSource | null)[] {
  const sources: PanelSource[] = [
    ...runs.flatMap((run) => (run.runId ? [{ kind: "run" as const, runId: run.runId }] : [])),
    ...terminals
      .filter((terminal) => terminal.state === "running")
      .map((terminal) => ({ kind: "terminal" as const, workspaceId: terminal.workspaceId })),
  ];
  return Array.from({ length: count }, (_, index) => sources[index] ?? null);
}

export function fitPanels(
  panels: readonly (PanelSource | null)[],
  count: number,
): (PanelSource | null)[] {
  return Array.from({ length: count }, (_, index) => panels[index] ?? null);
}

export function gridColumns(count: number): string {
  if (count <= 1) return "grid-cols-1";
  if (count <= 4) return "grid-cols-1 lg:grid-cols-2";
  return "grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3";
}
