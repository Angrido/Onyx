import type { GitHubRepoDto } from "@onyx/contracts";
import { describe, expect, it } from "vitest";
import { filterRepos, formatRepoSize, projectNameFor } from "@/lib/github";

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
