import type { Domain, TaskKind, WorkspaceSource } from "@onyx/contracts";
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

const DOMAIN_KEYWORDS: Readonly<Record<Exclude<Domain, "CUSTOM">, RegExp>> = {
  FRONTEND:
    /\b(ui|ux|frontend|front-end|css|tailwind|style|styles|component|components|page|pages|layout|button|form|modal|dialog|react|vue|svelte|html|responsive|interfaccia|pagina|pagine|pulsante|bottone|grafica|stile|componente|componenti|schermata)\b/g,
  BACKEND:
    /\b(api|apis|backend|back-end|endpoint|endpoints|server|service|services|route|routes|controller|auth|authentication|login|webhook|fastify|express|handler|servizio|servizi|rotta|rotte|autenticazione)\b/g,
  DATABASE:
    /\b(database|db|schema|migration|migrations|table|tables|column|columns|query|queries|sql|sqlite|postgres|prisma|migrazione|migrazioni|tabella|tabelle|colonna|colonne)\b/g,
  INFRA:
    /\b(deploy|deployment|docker|dockerfile|compose|ci|pipeline|workflow|github actions|nginx|caddy|systemd|container|kubernetes|k8s|terraform|infra|infrastructure|infrastruttura|rilascio)\b/g,
};

export function domainFromText(text: string, kind: TaskKind | null = null): Domain | null {
  const normalized = text.toLowerCase();
  const scores = new Map<Domain, number>();
  for (const [domain, pattern] of Object.entries(DOMAIN_KEYWORDS) as [Domain, RegExp][]) {
    const hits = normalized.match(pattern)?.length ?? 0;
    if (hits > 0) scores.set(domain, hits);
  }
  if (kind === "UI_STYLE") scores.set("FRONTEND", (scores.get("FRONTEND") ?? 0) + 2);
  let best: Domain | null = null;
  let bestScore = 0;
  for (const [domain, score] of scores) {
    if (score > bestScore) {
      best = domain;
      bestScore = score;
    }
  }
  return best;
}

export interface WorkspaceChoice {
  workspaceId: string;
  source: Exclude<WorkspaceSource, "chosen">;
}

export function chooseWorkspace(input: {
  workspaces: readonly { id: string; domain: Domain }[];
  inference: WorkspaceInference;
  text: string;
  kind?: TaskKind | null;
}): WorkspaceChoice | null {
  if (input.inference.workspaceId !== null)
    return { workspaceId: input.inference.workspaceId, source: "targets" };
  const domain = domainFromText(input.text, input.kind ?? null);
  const byDomain = domain
    ? input.workspaces.find((workspace) => workspace.domain === domain)
    : undefined;
  if (byDomain) return { workspaceId: byDomain.id, source: "prompt" };
  const first = input.workspaces[0];
  return first ? { workspaceId: first.id, source: "default" } : null;
}
