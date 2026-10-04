import type { CommandRuleSuggestion } from "@onyx/contracts";

export function defaultRules(suggestions: readonly CommandRuleSuggestion[]): string[] {
  return suggestions
    .filter((suggestion) => !suggestion.allowed && !suggestion.risky)
    .map((suggestion) => suggestion.rule);
}

export function ruleProgram(rule: string): string {
  const body = /^Bash\((.+)\)$/.exec(rule)?.[1] ?? rule;
  return body.endsWith(" *") ? body.slice(0, -2) : body;
}

export function ruleFor(program: string): string | null {
  const trimmed = program.trim().replace(/\s+\*$/, "");
  if (trimmed.length === 0 || trimmed.length > 196 || /[()\n]/.test(trimmed)) return null;
  return `Bash(${trimmed} *)`;
}
