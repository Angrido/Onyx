import type { GitHubRepoDto } from "@onyx/contracts";
import { describe, expect, it } from "vitest";
import {
  checksCount,
  filterRepos,
  formatRepoSize,
  projectNameFor,
  toggleNumber,
} from "@/lib/github";

function repo(
  fullName: string,
  description: string | null,
  language: string | null,
): GitHubRepoDto {
  const [owner = "", name = ""] = fullName.split("/");
  return {
    fullName,
    owner,
    name,
    description,
    private: false,
    fork: false,
    archived: false,
    defaultBranch: "main",
    language,
    sizeKb: 10,
    pushedAt: null,
    htmlUrl: `https://github.com/${fullName}`,
    importedProjectId: null,
  };
}

describe("github helpers", () => {
  it("filters repositories by every search term", () => {
    const repos = [
      repo("octo/shop", "Online shop", "TypeScript"),
      repo("octo/infra", "Terraform modules", "HCL"),
    ];
    expect(filterRepos(repos, "").map((entry) => entry.name)).toEqual(["shop", "infra"]);
    expect(filterRepos(repos, "octo typescript").map((entry) => entry.name)).toEqual(["shop"]);
    expect(filterRepos(repos, "terraform")).toHaveLength(1);
  });

  it("names projects like the API does", () => {
    expect(projectNameFor("my app")).toBe("my-app");
    expect(projectNameFor(".github")).toBe("github");
  });

  it("formats repository sizes", () => {
    expect(formatRepoSize(512)).toBe("512 KB");
    expect(formatRepoSize(2_048)).toBe("2.0 MB");
  });
});

describe("pull request helpers", () => {
  it("counts checks by result, failures first", () => {
    expect(checksCount({ passed: 2, failed: 1, pending: 0 })).toBe("1 failed · 2 passed");
    expect(checksCount({ passed: 0, failed: 0, pending: 3 })).toBe("3 running");
    expect(checksCount({ passed: 0, failed: 0, pending: 0 })).toBe("no checks reported");
  });

  it("toggles selected issue numbers in order", () => {
    expect(toggleNumber([4], 2)).toEqual([2, 4]);
    expect(toggleNumber([2, 4], 4)).toEqual([2]);
  });
});
