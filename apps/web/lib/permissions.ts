import type { CommandRuleSuggestion } from "@onyx/contracts";
import { msg } from "@/lib/i18n/core";

export function defaultRules(suggestions: readonly CommandRuleSuggestion[]): string[] {
  return suggestions
    .filter((suggestion) => !suggestion.allowed && suggestion.safety === "SAFE")
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

export const EXPIRY_OPTIONS = [
  { label: msg("No end"), hours: null },
  { label: msg("1 hour"), hours: 1 },
  { label: msg("1 day"), hours: 24 },
  { label: msg("7 days"), hours: 168 },
] as const;

export const SCOPE_LABELS = {
  TASK: msg("This task"),
  AGENT: msg("This agent profile"),
  PROJECT: msg("Whole project"),
} as const;
