import type { GitHubRepoDto } from "@onyx/contracts";

export const GITHUB_TOKEN_URL =
  "https://github.com/settings/personal-access-tokens/new?name=Onyx&description=Clone+repositories+into+Onyx&contents=read";

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
