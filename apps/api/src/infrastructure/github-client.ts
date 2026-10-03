import { z } from "zod";

export const DEFAULT_GITHUB_API_URL = "https://api.github.com";

const UserSchema = z.object({
  login: z.string(),
  name: z.string().nullable().optional(),
  avatar_url: z.string().nullable().optional(),
});

const RepoSchema = z.object({
  full_name: z.string(),
  name: z.string(),
  owner: z.object({ login: z.string() }),
  description: z.string().nullable().optional(),
  private: z.boolean().default(false),
  fork: z.boolean().default(false),
  archived: z.boolean().default(false),
  default_branch: z.string().default("main"),
  language: z.string().nullable().optional(),
  size: z.number().default(0),
  pushed_at: z.string().nullable().optional(),
  html_url: z.string(),
  clone_url: z.string(),
});

export type GitHubUser = z.infer<typeof UserSchema>;
export type GitHubRepo = z.infer<typeof RepoSchema>;

export interface RepoPage {
  repos: GitHubRepo[];
  hasNext: boolean;
}

export class GitHubError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "GitHubError";
  }
}

export interface GitHubClientOptions {
  baseUrl?: string;
  timeoutMs?: number;
}

const PAGE_SIZE = 100;

function describeFailure(status: number, body: string, authenticated: boolean): string {
  let message = "";
  try {
    const parsed: unknown = JSON.parse(body);
    if (typeof parsed === "object" && parsed !== null && "message" in parsed) {
      message = String(parsed.message);
    }
  } catch {
    message = body.slice(0, 200);
  }
  if (status === 401) return "GitHub rejected the token: it is wrong, expired or revoked";
  if (status === 403 && /rate limit/i.test(message))
    return authenticated
      ? "GitHub rate limit reached: try again later"
      : "GitHub rate limit reached: connect a token to raise the limit";
  if (status === 404) return "Not found on GitHub, or the token cannot see it";
  return `GitHub responded ${status}${message ? `: ${message}` : ""}`;
}

export class GitHubClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(options: GitHubClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_GITHUB_API_URL).replace(/\/+$/, "");
    this.timeoutMs = options.timeoutMs ?? 15_000;
  }

  async viewer(token: string): Promise<GitHubUser> {
    const { body } = await this.request("/user", token);
    return UserSchema.parse(body);
  }

  async viewerRepos(token: string, page: number): Promise<RepoPage> {
    return this.repoPage(
      `/user/repos?per_page=${PAGE_SIZE}&page=${page}&sort=pushed&affiliation=owner,collaborator,organization_member`,
      token,
    );
  }

  async ownerRepos(owner: string, token: string | null, page: number): Promise<RepoPage> {
    const path = `/users/${encodeURIComponent(owner)}/repos?per_page=${PAGE_SIZE}&page=${page}&sort=pushed&type=owner`;
    return this.repoPage(path, token);
  }

  async repo(fullName: string, token: string | null): Promise<GitHubRepo> {
    const [owner, name] = fullName.split("/");
    const { body } = await this.request(
      `/repos/${encodeURIComponent(owner ?? "")}/${encodeURIComponent(name ?? "")}`,
      token,
    );
    return RepoSchema.parse(body);
  }

  private async repoPage(path: string, token: string | null): Promise<RepoPage> {
    const { body, headers } = await this.request(path, token);
    const repos = z
      .array(z.unknown())
      .parse(body)
      .flatMap((entry) => {
        const parsed = RepoSchema.safeParse(entry);
        return parsed.success ? [parsed.data] : [];
      });
    return { repos, hasNext: /rel="next"/.test(headers.get("link") ?? "") };
  }

  private async request(
    path: string,
    token: string | null,
  ): Promise<{ body: unknown; headers: Headers }> {
    const headers: Record<string, string> = {
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "onyx-agent-control",
    };
    if (token) headers.authorization = `Bearer ${token}`;
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        headers,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new GitHubError(
        502,
        `GitHub is unreachable from this machine (${error instanceof Error ? error.message : String(error)})`,
      );
    }
    const text = await response.text();
    if (!response.ok)
      throw new GitHubError(
        response.status,
        describeFailure(response.status, text, token !== null),
      );
    return { body: text.length > 0 ? JSON.parse(text) : null, headers: response.headers };
  }
}
