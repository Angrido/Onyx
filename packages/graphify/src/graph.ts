import type { ImportRef } from "@onyx/lean-ctx";

export type EdgeKindName =
  "STATIC_IMPORT" | "DYNAMIC_IMPORT" | "REQUIRE" | "REEXPORT" | "TYPE_ONLY";

export interface GraphEdge {
  from: string;
  to: string | null;
  external: string | null;
  kind: EdgeKindName;
  specifier: string;
  names: string[];
}

export function edgeKindOf(ref: ImportRef): EdgeKindName {
  if (ref.kind === "reexport") return "REEXPORT";
  if (ref.typeOnly) return "TYPE_ONLY";
  switch (ref.kind) {
    case "dynamic":
      return "DYNAMIC_IMPORT";
    case "require":
      return "REQUIRE";
    case "static":
      return "STATIC_IMPORT";
  }
}

export class DependencyGraph {
  private readonly outgoing = new Map<string, Set<string>>();
  private readonly incoming = new Map<string, Set<string>>();
  private readonly edgesByOrigin = new Map<string, GraphEdge[]>();
  private readonly nodeSet: ReadonlySet<string>;

  constructor(
    readonly nodes: readonly string[],
    readonly edges: readonly GraphEdge[],
  ) {
    this.nodeSet = new Set(nodes);
    for (const node of nodes) {
      this.outgoing.set(node, new Set());
      this.incoming.set(node, new Set());
    }
    for (const edge of edges) {
      const fromOrigin = this.edgesByOrigin.get(edge.from) ?? [];
      fromOrigin.push(edge);
      this.edgesByOrigin.set(edge.from, fromOrigin);
      if (edge.to === null || edge.to === edge.from) continue;
      if (!this.nodeSet.has(edge.from) || !this.nodeSet.has(edge.to)) continue;
      this.outgoing.get(edge.from)?.add(edge.to);
      this.incoming.get(edge.to)?.add(edge.from);
    }
  }

  has(node: string): boolean {
    return this.nodeSet.has(node);
  }

  dependencies(node: string): string[] {
    return [...(this.outgoing.get(node) ?? [])];
  }

  dependents(node: string): string[] {
    return [...(this.incoming.get(node) ?? [])];
  }

  outDegree(node: string): number {
    return this.outgoing.get(node)?.size ?? 0;
  }

  inDegree(node: string): number {
    return this.incoming.get(node)?.size ?? 0;
  }

  internalEdgeCount(): number {
    let count = 0;
    for (const targets of this.outgoing.values()) count += targets.size;
    return count;
  }

  edgesFrom(node: string): readonly GraphEdge[] {
    return this.edgesByOrigin.get(node) ?? [];
  }

  isBarrel(node: string): boolean {
    return this.edgesFrom(node).some((edge) => edge.kind === "REEXPORT" && edge.to !== null);
  }
}
