import type { DependencyGraph, GraphEdge } from "./graph";

export type ExportsLookup = (relPath: string) => readonly string[] | undefined;

const MAX_BARREL_DEPTH = 6;
const OPAQUE_NAMES = new Set(["*", "default"]);

function findOwner(
  graph: DependencyGraph,
  exportsOf: ExportsLookup,
  start: string,
  name: string,
): string | null {
  const visited = new Set([start]);
  let frontier = [start];
  for (let depth = 0; depth <= MAX_BARREL_DEPTH && frontier.length > 0; depth += 1) {
    const next: string[] = [];
    for (const node of frontier) {
      const reexports = graph
        .edgesFrom(node)
        .filter((edge) => edge.kind === "REEXPORT" && edge.to !== null);
      const explicit = reexports.find((edge) => edge.names.includes(name));
      if (explicit?.to) {
        if (!visited.has(explicit.to)) {
          visited.add(explicit.to);
          next.push(explicit.to);
        }
        continue;
      }
      if (exportsOf(node)?.includes(name)) return node;
      for (const edge of reexports) {
        if (!edge.to || visited.has(edge.to) || !edge.names.includes("*")) continue;
        visited.add(edge.to);
        next.push(edge.to);
      }
    }
    frontier = next;
  }
  return null;
}

export function resolveThroughBarrels(
  graph: DependencyGraph,
  exportsOf: ExportsLookup,
  edge: GraphEdge,
): Map<string, string[]> {
  const owners = new Map<string, string[]>();
  if (edge.to === null) return owners;
  const names = edge.names.filter((name) => !OPAQUE_NAMES.has(name));
  if (names.length === 0 || !graph.isBarrel(edge.to)) {
    owners.set(edge.to, [...edge.names]);
    return owners;
  }
  for (const name of names) {
    const owner = findOwner(graph, exportsOf, edge.to, name) ?? edge.to;
    owners.set(owner, [...(owners.get(owner) ?? []), name]);
  }
  return owners;
}

export interface EffectiveDependency {
  relPath: string;
  names: string[];
  typeOnly: boolean;
}

export function effectiveDependencies(
  graph: DependencyGraph,
  exportsOf: ExportsLookup,
  node: string,
): EffectiveDependency[] {
  const result = new Map<string, EffectiveDependency>();
  for (const edge of graph.edgesFrom(node)) {
    for (const [target, names] of resolveThroughBarrels(graph, exportsOf, edge)) {
      if (target === node) continue;
      const current = result.get(target);
      result.set(target, {
        relPath: target,
        names: [...new Set([...(current?.names ?? []), ...names])],
        typeOnly: (current?.typeOnly ?? true) && edge.kind === "TYPE_ONLY",
      });
    }
  }
  return [...result.values()];
}
