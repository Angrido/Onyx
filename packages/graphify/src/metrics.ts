import type { DependencyGraph } from "./graph";

export type Direction = "in" | "out" | "both";

export interface PageRankOptions {
  damping?: number;
  maxIterations?: number;
  tolerance?: number;
}

export function pageRank(
  graph: DependencyGraph,
  options: PageRankOptions = {},
): Map<string, number> {
  const damping = options.damping ?? 0.85;
  const maxIterations = options.maxIterations ?? 100;
  const tolerance = options.tolerance ?? 1e-10;
  const nodes = graph.nodes;
  const count = nodes.length;
  const ranks = new Map<string, number>();
  if (count === 0) return ranks;

  for (const node of nodes) ranks.set(node, 1 / count);
  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    let danglingMass = 0;
    for (const node of nodes) {
      if (graph.outDegree(node) === 0) danglingMass += ranks.get(node) ?? 0;
    }
    const base = (1 - damping) / count + (damping * danglingMass) / count;
    const next = new Map<string, number>();
    for (const node of nodes) next.set(node, base);
    for (const node of nodes) {
      const targets = graph.dependencies(node);
      if (targets.length === 0) continue;
      const share = (damping * (ranks.get(node) ?? 0)) / targets.length;
      for (const target of targets) next.set(target, (next.get(target) ?? 0) + share);
    }
    let delta = 0;
    for (const node of nodes) delta += Math.abs((next.get(node) ?? 0) - (ranks.get(node) ?? 0));
    for (const [node, rank] of next) ranks.set(node, rank);
    if (delta < tolerance) break;
  }
  return ranks;
}

export function stronglyConnectedComponents(graph: DependencyGraph): string[][] {
  const indexOf = new Map<string, number>();
  const lowLink = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const components: string[][] = [];
  let nextIndex = 0;

  for (const root of graph.nodes) {
    if (indexOf.has(root)) continue;
    const work: { node: string; neighbors: string[]; cursor: number }[] = [];
    const enter = (node: string) => {
      indexOf.set(node, nextIndex);
      lowLink.set(node, nextIndex);
      nextIndex += 1;
      stack.push(node);
      onStack.add(node);
      work.push({ node, neighbors: graph.dependencies(node), cursor: 0 });
    };
    enter(root);

    while (work.length > 0) {
      const frame = work[work.length - 1];
      if (!frame) break;
      if (frame.cursor < frame.neighbors.length) {
        const neighbor = frame.neighbors[frame.cursor] ?? "";
        frame.cursor += 1;
        if (!indexOf.has(neighbor)) {
          enter(neighbor);
        } else if (onStack.has(neighbor)) {
          lowLink.set(
            frame.node,
            Math.min(lowLink.get(frame.node) ?? 0, indexOf.get(neighbor) ?? 0),
          );
        }
        continue;
      }
      work.pop();
      const parent = work[work.length - 1];
      if (parent) {
        lowLink.set(
          parent.node,
          Math.min(lowLink.get(parent.node) ?? 0, lowLink.get(frame.node) ?? 0),
        );
      }
      if (lowLink.get(frame.node) === indexOf.get(frame.node)) {
        const component: string[] = [];
        for (;;) {
          const member = stack.pop();
          if (member === undefined) break;
          onStack.delete(member);
          component.push(member);
          if (member === frame.node) break;
        }
        components.push(component.sort());
      }
    }
  }
  return components;
}

export function dependencyCycles(graph: DependencyGraph): string[][] {
  return stronglyConnectedComponents(graph)
    .filter((component) => component.length > 1)
    .sort((a, b) => b.length - a.length);
}

export function neighborhood(
  graph: DependencyGraph,
  focus: Iterable<string>,
  depth: number,
  direction: Direction = "both",
): Map<string, number> {
  const distances = new Map<string, number>();
  let frontier: string[] = [];
  for (const node of focus) {
    if (!graph.has(node) || distances.has(node)) continue;
    distances.set(node, 0);
    frontier.push(node);
  }
  for (let level = 1; level <= depth && frontier.length > 0; level += 1) {
    const next: string[] = [];
    for (const node of frontier) {
      const neighbors = [
        ...(direction === "in" ? [] : graph.dependencies(node)),
        ...(direction === "out" ? [] : graph.dependents(node)),
      ];
      for (const neighbor of neighbors) {
        if (distances.has(neighbor)) continue;
        distances.set(neighbor, level);
        next.push(neighbor);
      }
    }
    frontier = next;
  }
  return distances;
}

export function transitiveDependents(graph: DependencyGraph, nodes: Iterable<string>): Set<string> {
  const start = [...nodes].filter((node) => graph.has(node));
  const reached = neighborhood(graph, start, Number.POSITIVE_INFINITY, "in");
  for (const node of start) reached.delete(node);
  return new Set(reached.keys());
}

export const BLAST_RADIUS_NODE_LIMIT = 4_000;

export function blastRadii(graph: DependencyGraph): Map<string, number> | null {
  if (graph.nodes.length > BLAST_RADIUS_NODE_LIMIT) return null;
  const radii = new Map<string, number>();
  for (const node of graph.nodes) {
    radii.set(node, graph.inDegree(node) === 0 ? 0 : transitiveDependents(graph, [node]).size);
  }
  return radii;
}
