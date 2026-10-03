import type { Domain } from "@onyx/contracts";
import picomatch from "picomatch";

export interface WorkspaceZone {
  id: string;
  name: string;
  domain: Domain;
  pathGlobs: readonly string[];
}

export interface WorkspaceInference {
  workspaceId: string | null;
  matches: { workspaceId: string; paths: number }[];
  domains: Domain[];
  unmatched: string[];
}

export class ZoneMap {
  private readonly zones: { zone: WorkspaceZone; isMatch: (path: string) => boolean }[];

  constructor(zones: readonly WorkspaceZone[]) {
    this.zones = zones
      .filter((zone) => zone.pathGlobs.length > 0)
      .map((zone) => ({ zone, isMatch: picomatch([...zone.pathGlobs], { dot: true }) }));
  }

  zoneOf(path: string): WorkspaceZone | null {
    return this.zones.find((entry) => entry.isMatch(path))?.zone ?? null;
  }

  infer(paths: readonly string[]): WorkspaceInference {
    const counts = new Map<string, number>();
    const domains = new Set<Domain>();
    const unmatched: string[] = [];
    for (const path of paths) {
      const zone = this.zoneOf(path);
      if (!zone) {
        unmatched.push(path);
        continue;
      }
      counts.set(zone.id, (counts.get(zone.id) ?? 0) + 1);
      domains.add(zone.domain);
    }
    const order = this.zones.map((entry) => entry.zone.id);
    const matches = [...counts.entries()]
      .map(([workspaceId, matched]) => ({ workspaceId, paths: matched }))
      .sort(
        (a, b) => b.paths - a.paths || order.indexOf(a.workspaceId) - order.indexOf(b.workspaceId),
      );
    return {
      workspaceId: matches[0]?.workspaceId ?? null,
      matches,
      domains: [...domains].sort(),
      unmatched,
    };
  }
}
