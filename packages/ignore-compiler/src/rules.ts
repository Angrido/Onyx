export type RuleAction = "EXCLUDE" | "INCLUDE";
export type RuleSource = "MANUAL" | "PRESET" | "HEURISTIC" | "SECURITY";

export interface PolicyRule {
  pattern: string;
  action: RuleAction;
  source: RuleSource;
  locked: boolean;
  reason: string | null;
}

export function normalizePattern(raw: string): string | null {
  let pattern = raw.trim().replace(/\\/g, "/");
  if (pattern.startsWith("./")) pattern = pattern.slice(2);
  if (pattern.length === 0 || pattern.startsWith("#")) return null;
  if (pattern.split("/").some((segment) => segment === "..")) return null;
  return pattern;
}

export function rule(
  pattern: string,
  options: Partial<Omit<PolicyRule, "pattern">> = {},
): PolicyRule {
  return {
    pattern,
    action: options.action ?? "EXCLUDE",
    source: options.source ?? "MANUAL",
    locked: options.locked ?? false,
    reason: options.reason ?? null,
  };
}

export function isDirectoryPattern(pattern: string): boolean {
  return pattern.endsWith("/") && !pattern.endsWith("**/");
}

export function contentsPattern(pattern: string): string {
  const core = pattern.replace(/\/+$/, "");
  return core.startsWith("/") || core.includes("/") ? `${core}/**` : `**/${core}/**`;
}

export function canonicalPattern(pattern: string): string {
  const expanded = isDirectoryPattern(pattern) ? contentsPattern(pattern) : pattern;
  const body = expanded.replace(/^\/+/, "");
  return expanded.startsWith("/") && body.replace(/\/+$/, "").includes("/") ? body : expanded;
}

export function ruleKey(policyRule: Pick<PolicyRule, "action" | "pattern">): string {
  return `${policyRule.action}:${canonicalPattern(policyRule.pattern)}`;
}

export function toGitignoreLine(policyRule: PolicyRule): string {
  return policyRule.action === "INCLUDE" ? `!${policyRule.pattern}` : policyRule.pattern;
}

export function parseIgnoreFile(text: string, source: RuleSource = "MANUAL"): PolicyRule[] {
  const rules: PolicyRule[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) continue;
    const negated = trimmed.startsWith("!");
    const pattern = normalizePattern(negated ? trimmed.slice(1) : trimmed);
    if (pattern === null) continue;
    rules.push(rule(pattern, { action: negated ? "INCLUDE" : "EXCLUDE", source }));
  }
  return rules;
}

export function renderIgnoreFile(rules: readonly PolicyRule[]): string {
  const lines = rules.map(toGitignoreLine);
  return lines.length === 0 ? "" : `${lines.join("\n")}\n`;
}

export function sameRules(a: readonly PolicyRule[], b: readonly PolicyRule[]): boolean {
  return renderIgnoreFile(a) === renderIgnoreFile(b);
}
