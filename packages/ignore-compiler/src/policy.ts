import ignore, { type Ignore } from "ignore";
import { toGitignoreLine, type PolicyRule } from "./rules";

export interface Explanation {
  excluded: boolean;
  rule: PolicyRule | null;
}

function cleanPath(relPath: string): string {
  return relPath
    .replace(/\\/g, "/")
    .replace(/^\.\/+/, "")
    .replace(/^\/+/, "");
}

export class ContextPolicy {
  readonly rules: readonly PolicyRule[];
  private readonly matcher: Ignore;
  private readonly rulesByLine = new Map<string, PolicyRule>();
  private readonly cache = new Map<string, Explanation>();

  constructor(rules: readonly PolicyRule[]) {
    const locked = rules.filter((candidate) => candidate.locked);
    const unlocked = rules.filter((candidate) => !candidate.locked);
    this.rules = [...unlocked, ...locked];
    this.matcher = ignore({ allowRelativePaths: true });
    for (const policyRule of this.rules) {
      const line = toGitignoreLine(policyRule);
      this.matcher.add(line);
      this.rulesByLine.set(line, policyRule);
    }
  }

  static compose(...layers: readonly (readonly PolicyRule[])[]): ContextPolicy {
    return new ContextPolicy(layers.flat());
  }

  get hasNegations(): boolean {
    return this.rules.some((candidate) => candidate.action === "INCLUDE");
  }

  isExcluded(relPath: string, isDirectory = false): boolean {
    return this.explain(relPath, isDirectory).excluded;
  }

  explain(relPath: string, isDirectory = false): Explanation {
    const path = cleanPath(relPath);
    if (path.length === 0) return { excluded: false, rule: null };
    const key = isDirectory ? `${path.replace(/\/+$/, "")}/` : path;
    const cached = this.cache.get(key);
    if (cached) return cached;
    const result = this.matcher.checkIgnore(key);
    const matched = result.rule
      ? (this.rulesByLine.get(
          result.rule.negative ? `!${result.rule.pattern}` : result.rule.pattern,
        ) ?? null)
      : null;
    const explanation = { excluded: result.ignored, rule: result.ignored ? matched : null };
    this.cache.set(key, explanation);
    return explanation;
  }

  filter<T>(items: readonly T[], pathOf: (item: T) => string): T[] {
    return items.filter((item) => !this.isExcluded(pathOf(item)));
  }
}

export const EMPTY_POLICY = new ContextPolicy([]);
