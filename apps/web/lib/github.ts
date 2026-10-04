import type {
  ChangelogSection,
  ChecksState,
  CheckResult,
  GitHubRepoDto,
  PullRequestDto,
  PullRequestState,
} from "@onyx/contracts";

export const GITHUB_TOKEN_URL =
  "https://github.com/settings/personal-access-tokens/new?name=Onyx&description=Clone+repositories+and+open+pull+requests+from+Onyx&contents=write&pull_requests=write&issues=read&checks=read&statuses=read";

export function projectNameFor(repoName: string): string {
  const cleaned = repoName.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[^A-Za-z0-9]+/, "");
  return (cleaned.length > 0 ? cleaned : "project").slice(0, 64);
}

export function filterRepos(repos: readonly GitHubRepoDto[], query: string): GitHubRepoDto[] {
  const terms = query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((term) => term.length > 0);
  if (terms.length === 0) return [...repos];
  return repos.filter((repo) => {
    const haystack =
      `${repo.fullName} ${repo.description ?? ""} ${repo.language ?? ""}`.toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}

export function formatRepoSize(sizeKb: number): string {
  if (sizeKb < 1_024) return `${sizeKb} KB`;
  if (sizeKb < 1_024 * 1_024) return `${(sizeKb / 1_024).toFixed(1)} MB`;
  return `${(sizeKb / 1_024 / 1_024).toFixed(1)} GB`;
}

type Tone = "neutral" | "primary" | "success" | "warning" | "danger";

export const CHECKS_LABELS: Record<ChecksState, string> = {
  NONE: "No checks",
  PENDING: "Checks running",
  SUCCESS: "Checks passed",
  FAILURE: "Checks failed",
};

export const CHECKS_TONES: Record<ChecksState, Tone> = {
  NONE: "neutral",
  PENDING: "warning",
  SUCCESS: "success",
  FAILURE: "danger",
};

export const CHECK_RESULT_LABELS: Record<CheckResult, string> = {
  PENDING: "running",
  SUCCESS: "passed",
  FAILURE: "failed",
  NEUTRAL: "skipped",
};

export const CHECK_RESULT_TONES: Record<CheckResult, Tone> = {
  PENDING: "warning",
  SUCCESS: "success",
  FAILURE: "danger",
  NEUTRAL: "neutral",
};

export const PULL_STATE_LABELS: Record<PullRequestState, string> = {
  OPEN: "Open",
  CLOSED: "Closed",
  MERGED: "Merged",
};

export const PULL_STATE_TONES: Record<PullRequestState, Tone> = {
  OPEN: "primary",
  CLOSED: "neutral",
  MERGED: "success",
};

export const CHANGELOG_SECTION_LABELS: Record<ChangelogSection, string> = {
  BREAKING: "Breaking",
  FEATURES: "Feature",
  FIXES: "Fix",
  PERFORMANCE: "Performance",
  REFACTORING: "Refactoring",
  DOCS: "Docs",
  OTHER: "Other",
};

export function checksCount(pull: Pick<PullRequestDto, "passed" | "failed" | "pending">): string {
  const parts = [
    pull.failed > 0 ? `${pull.failed} failed` : null,
    pull.pending > 0 ? `${pull.pending} running` : null,
    pull.passed > 0 ? `${pull.passed} passed` : null,
  ].filter((part): part is string => part !== null);
  return parts.length > 0 ? parts.join(" · ") : "no checks reported";
}

export function toggleNumber(selected: readonly number[], number: number): number[] {
  return selected.includes(number)
    ? selected.filter((entry) => entry !== number)
    : [...selected, number].sort((left, right) => left - right);
}
