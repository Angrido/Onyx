import picomatch from "picomatch";

export type DomainName = "FRONTEND" | "BACKEND" | "DATABASE" | "INFRA" | "CUSTOM";

export interface WorkspaceRule {
  workspaceId: string;
  domain: DomainName;
  globs: readonly string[];
}

export interface DomainAssignment {
  domain: DomainName;
  workspaceId: string | null;
}

const HEURISTICS: readonly { domain: DomainName; test: RegExp }[] = [
  {
    domain: "INFRA",
    test: /(^|\/)(deploy|infra|infrastructure|ops|\.github|docker|k8s|kubernetes|helm|terraform|ansible|scripts)\/|(^|\/)(Dockerfile[^/]*|docker-compose[^/]*\.ya?ml|Caddyfile|Makefile)$|\.(sh|tf|service|timer)$/i,
  },
  {
    domain: "DATABASE",
    test: /(^|\/)(prisma|migrations?|db|database|schema|sql)\/|\.(sql|prisma)$|(^|\/)(models|entities)\.(py|ts)$/i,
  },
  {
    domain: "FRONTEND",
    test: /(^|\/)(web|frontend|client|ui|components|pages|hooks|styles|public)\/|\.(tsx|jsx|vue|svelte|css|scss|html)$/i,
  },
  {
    domain: "BACKEND",
    test: /(^|\/)(api|server|backend|services?|routes|controllers|handlers|workers?|domain|application)\/|\.py$/i,
  },
];

export function heuristicDomain(relPath: string): DomainName | null {
  for (const rule of HEURISTICS) if (rule.test.test(relPath)) return rule.domain;
  return null;
}

export class DomainClassifier {
  private readonly matchers: { rule: WorkspaceRule; isMatch: (path: string) => boolean }[];

  constructor(rules: readonly WorkspaceRule[] = []) {
    this.matchers = rules
      .filter((rule) => rule.globs.length > 0)
      .map((rule) => ({ rule, isMatch: picomatch([...rule.globs], { dot: true }) }));
  }

  classify(relPath: string): DomainAssignment | null {
    for (const { rule, isMatch } of this.matchers) {
      if (isMatch(relPath)) return { domain: rule.domain, workspaceId: rule.workspaceId };
    }
    const domain = heuristicDomain(relPath);
    return domain === null ? null : { domain, workspaceId: null };
  }
}

export function proposeDomainGlobs(
  assignments: Iterable<{ relPath: string; domain: DomainName | null }>,
  maxDepth = 2,
): Partial<Record<DomainName, string[]>> {
  const byDomain = new Map<DomainName, Map<string, number>>();
  const totals = new Map<string, number>();
  for (const { relPath, domain } of assignments) {
    const segments = relPath.split("/");
    const prefix = segments.slice(0, Math.min(maxDepth, segments.length - 1)).join("/");
    totals.set(prefix, (totals.get(prefix) ?? 0) + 1);
    if (domain === null) continue;
    const counts = byDomain.get(domain) ?? new Map<string, number>();
    counts.set(prefix, (counts.get(prefix) ?? 0) + 1);
    byDomain.set(domain, counts);
  }
  const proposal: Partial<Record<DomainName, string[]>> = {};
  for (const [domain, counts] of byDomain) {
    const globs = [...counts.entries()]
      .filter(
        ([prefix, count]) => prefix.length > 0 && count / (totals.get(prefix) ?? count) >= 0.6,
      )
      .sort((a, b) => b[1] - a[1])
      .map(([prefix]) => `${prefix}/**`);
    if (globs.length > 0) proposal[domain] = globs;
  }
  return proposal;
}
