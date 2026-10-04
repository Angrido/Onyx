import type { Domain } from "@onyx/contracts";
import { DEFAULT_WORKSPACES, type WorkspaceTemplate } from "./workspace-templates";

export interface ProjectLayout {
  directories: readonly string[];
  files: readonly string[];
  children: ReadonlyMap<string, readonly string[]>;
}

export interface WorkspaceProposal {
  name: string;
  domain: Domain;
  pathGlobs: string[];
  reason: string;
}

export const LAYOUT_CONTAINERS = ["apps", "packages", "services", "libs", "modules", "src"];

const DOMAIN_PATTERNS: readonly (readonly [Domain, RegExp])[] = [
  ["DATABASE", /^(db|database|databases|prisma|migrations|sql|schema|schemas|models|drizzle)$/],
  [
    "INFRA",
    /^(deploy|deployment|deployments|infra|infrastructure|ops|terraform|k8s|kubernetes|helm|charts|docker|\.github|\.circleci|ansible)$/,
  ],
  [
    "BACKEND",
    /^(api|apis|server|servers|backend|back-end|service|services|functions|lambda|lambdas|routes|controllers|handlers|cmd|worker|workers|core|domain|jobs)$/,
  ],
  [
    "FRONTEND",
    /^(web|www|frontend|front-end|client|clients|ui|app|site|website|components|pages|views|styles|public|mobile|dashboard|admin)$/,
  ],
];

const DOMAIN_NAMES: Readonly<Record<Domain, string>> = {
  FRONTEND: "Frontend",
  BACKEND: "Backend",
  DATABASE: "Database",
  INFRA: "Infra",
  CUSTOM: "Core",
};

const INFRA_FILES =
  /^(Dockerfile|docker-compose.*\.ya?ml|compose\.ya?ml|Procfile|fly\.toml|vercel\.json|netlify\.toml)$/;

function classify(name: string): Domain | null {
  const lower = name.toLowerCase();
  for (const [domain, pattern] of DOMAIN_PATTERNS) if (pattern.test(lower)) return domain;
  return null;
}

export function proposeWorkspaces(layout: ProjectLayout): WorkspaceProposal[] {
  const globs = new Map<Domain, Set<string>>();
  const add = (domain: Domain, glob: string) => {
    const set = globs.get(domain) ?? new Set<string>();
    set.add(glob);
    globs.set(domain, set);
  };
  const unclassified: string[] = [];
  for (const directory of layout.directories) {
    const domain = classify(directory);
    if (domain) {
      add(domain, `${directory}/**`);
      continue;
    }
    if (!LAYOUT_CONTAINERS.includes(directory)) {
      unclassified.push(directory);
      continue;
    }
    let placed = false;
    for (const child of layout.children.get(directory) ?? []) {
      const childDomain = classify(child);
      if (!childDomain) continue;
      add(childDomain, `${directory}/${child}/**`);
      placed = true;
    }
    if (!placed && directory === "src") unclassified.push(directory);
  }
  for (const file of layout.files) if (INFRA_FILES.test(file)) add("INFRA", file);
  if (!globs.has("FRONTEND") && !globs.has("BACKEND")) {
    const code = unclassified.filter((directory) => directory === "src" || directory === "lib");
    add("CUSTOM", code.length > 0 ? `${code[0]}/**` : "**");
  }
  const order: Domain[] = ["FRONTEND", "BACKEND", "CUSTOM", "DATABASE", "INFRA"];
  return order.flatMap((domain) => {
    const set = globs.get(domain);
    if (!set) return [];
    const pathGlobs = [...set].sort();
    return [
      {
        name: DOMAIN_NAMES[domain],
        domain,
        pathGlobs,
        reason: pathGlobs.map((glob) => glob.replace(/\/\*\*$/, "/")).join(", "),
      },
    ];
  });
}

export function templateFor(
  domain: Domain,
): Pick<WorkspaceTemplate, "agentConfigName" | "resetStrategy" | "color"> {
  const template = DEFAULT_WORKSPACES.find((entry) => entry.domain === domain);
  return template
    ? {
        agentConfigName: template.agentConfigName,
        resetStrategy: template.resetStrategy,
        color: template.color,
      }
    : { agentConfigName: "builder", resetStrategy: "HANDOFF", color: "emerald" };
}
