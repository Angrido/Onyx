import type { Domain, RoutingFeatures, TaskKind } from "@onyx/contracts";

export interface TargetFact {
  path: string;
  domain: Domain | null;
  blastRadius: number | null;
  rawTokens: number;
}

export interface FeatureInput {
  kind: TaskKind;
  title: string;
  prompt: string;
  workspaceDomain: Domain | null;
  targets: readonly TargetFact[];
  priorFailures: number;
}

const MAX_RECORDED_TARGETS = 20;

const ARCHITECTURE_KEYWORDS: readonly { label: string; pattern: RegExp }[] = [
  { label: "architecture", pattern: /\barchitet+ur\w*|\barchitect\w*/ },
  { label: "schema", pattern: /\bschem[ai]\w*/ },
  { label: "migration", pattern: /\bmigra(?:tion|zion|te|re)\w*/ },
  {
    label: "security",
    pattern: /\bsecurity\b|\bsicurezza\b|\bauth(?:entication|orization|z|n)?\b/,
  },
  { label: "concurrency", pattern: /\bconcurren\w*|\brace condition\w*|\bdeadlock\w*/ },
  { label: "refactor", pattern: /\brefactor\w*|\bristruttur\w*/ },
  { label: "public api", pattern: /\bpublic api\b|\bapi pubblic\w*|\bbreaking change\w*/ },
  { label: "data model", pattern: /\bdata model\w*|\bmodello dati\b|\bdatabase design\b/ },
  { label: "performance", pattern: /\bperformance\b|\bprestazioni\b|\bscalab\w*/ },
];

const STYLE_EXTENSIONS = /\.(css|scss|sass|less|styl|pcss)$/i;

export function findArchitectureKeywords(text: string): string[] {
  const normalized = text.toLowerCase();
  return ARCHITECTURE_KEYWORDS.filter((keyword) => keyword.pattern.test(normalized)).map(
    (keyword) => keyword.label,
  );
}

export function isStylePath(path: string): boolean {
  return STYLE_EXTENSIONS.test(path);
}

export function extractFeatures(input: FeatureInput): RoutingFeatures {
  const domains = [
    ...new Set(
      input.targets
        .map((target) => target.domain)
        .filter((domain): domain is Domain => domain !== null),
    ),
  ].sort();
  const workspaceDomains =
    input.workspaceDomain === null ? domains : [...new Set([input.workspaceDomain, ...domains])];
  const blastRadius = Math.max(0, ...input.targets.map((target) => target.blastRadius ?? 0));
  return {
    kind: input.kind,
    workspaceDomain: input.workspaceDomain,
    domains,
    crossDomain: workspaceDomains.length > 1,
    filesTouched: input.targets.length,
    targets: input.targets.slice(0, MAX_RECORDED_TARGETS).map((target) => target.path),
    blastRadius,
    archKeywords: findArchitectureKeywords(`${input.title}\n${input.prompt}`),
    styleOnly:
      input.targets.length > 0 && input.targets.every((target) => isStylePath(target.path)),
    contextTokens: input.targets.reduce((sum, target) => sum + target.rawTokens, 0),
    priorFailures: input.priorFailures,
  };
}
