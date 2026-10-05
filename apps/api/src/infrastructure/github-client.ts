import { z } from "zod";
import { interpolate, msg } from "../i18n";

export const DEFAULT_GITHUB_API_URL = "https://api.github.com";

const UserSchema = z.object({
  id: z.number().optional(),
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

const IssueSchema = z.object({
  number: z.number(),
  title: z.string(),
  body: z.string().nullable().optional(),
  html_url: z.string(),
  state: z.string().default("open"),
  labels: z
    .array(z.union([z.string(), z.object({ name: z.string().nullable().optional() })]))
    .default([]),
  user: z.object({ login: z.string() }).nullable().optional(),
  comments: z.number().default(0),
  created_at: z.string(),
  updated_at: z.string(),
  pull_request: z.unknown().optional(),
});

const PullSchema = z.object({
  number: z.number(),
  title: z.string(),
  html_url: z.string(),
  state: z.string(),
  draft: z.boolean().default(false),
  merged_at: z.string().nullable().optional(),
  head: z.object({ ref: z.string(), sha: z.string() }),
  base: z.object({ ref: z.string() }),
});

const CheckRunsSchema = z.object({
  check_runs: z
    .array(
      z.object({
        name: z.string(),
        status: z.string(),
        conclusion: z.string().nullable().optional(),
        html_url: z.string().nullable().optional(),
        details_url: z.string().nullable().optional(),
      }),
    )
    .default([]),
});

const CombinedStatusSchema = z.object({
  statuses: z
    .array(
      z.object({
        context: z.string(),
        state: z.string(),
        target_url: z.string().nullable().optional(),
      }),
    )
    .default([]),
});

export type GitHubUser = z.infer<typeof UserSchema>;
export type GitHubRepo = z.infer<typeof RepoSchema>;
export type GitHubIssue = z.infer<typeof IssueSchema>;
export type GitHubPull = z.infer<typeof PullSchema>;
export type GitHubCheckRuns = z.infer<typeof CheckRunsSchema>;
export type GitHubCombinedStatus = z.infer<typeof CombinedStatusSchema>;

export interface IssuePage {
  issues: GitHubIssue[];
  hasNext: boolean;
}

export type Conditional<T> =
  { notModified: true } | { notModified: false; body: T; etag: string | null };

export interface NewPull {
  title: string;
  head: string;
  base: string;
  body: string;
  draft: boolean;
}

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

const FAILURE = {
  token: msg("GitHub rejected the token: it is wrong, expired or revoked"),
  rateLimit: msg("GitHub rate limit reached: try again later"),
  rateLimitToken: msg("GitHub rate limit reached: connect a token to raise the limit"),
  notFound: msg("Not found on GitHub, or the token cannot see it"),
  pullRequests: msg(
    "The GitHub token cannot do this: it needs Pull requests read and write on this repository",
  ),
  unreachable: msg("GitHub is unreachable from this machine ({error})"),
} as const;

export const GITHUB_FAILURE_KEYS: readonly string[] = Object.values(FAILURE);

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
  if (status === 401) return FAILURE.token;
  if (status === 403 && /rate limit/i.test(message))
    return authenticated ? FAILURE.rateLimit : FAILURE.rateLimitToken;
  if (status === 429) return FAILURE.rateLimit;
  if (status === 404) return FAILURE.notFound;
  if (status === 403 && /resource not accessible/i.test(message)) return FAILURE.pullRequests;
  const details = validationDetails(body);
  return `GitHub responded ${status}${message ? `: ${message}` : ""}${details ? ` (${details})` : ""}`;
}

function validationDetails(body: string): string | null {
  try {
    const parsed: unknown = JSON.parse(body);
    if (typeof parsed !== "object" || parsed === null || !("errors" in parsed)) return null;
    const errors = (parsed as { errors: unknown }).errors;
    if (!Array.isArray(errors)) return null;
    const messages = errors.flatMap((entry: unknown) =>
      typeof entry === "object" && entry !== null && "message" in entry
        ? [String((entry as { message: unknown }).message)]
        : [],
    );
    return messages.length > 0 ? messages.join("; ").slice(0, 300) : null;
  } catch {
    return null;
  }
}

function repoPath(fullName: string): string {
  const [owner, name] = fullName.split("/");
  return `/repos/${encodeURIComponent(owner ?? "")}/${encodeURIComponent(name ?? "")}`;
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
    const { body } = await this.request(repoPath(fullName), token);
    return RepoSchema.parse(body);
  }

  async issues(
    fullName: string,
    token: string | null,
    page: number,
    label?: string,
  ): Promise<IssuePage> {
    const query = new URLSearchParams({
      state: "open",
      per_page: "50",
      page: String(page),
      sort: "updated",
    });
    if (label) query.set("labels", label);
    const { body, headers } = await this.request(`${repoPath(fullName)}/issues?${query}`, token);
    const issues = z
      .array(z.unknown())
      .parse(body)
      .flatMap((entry) => {
        const parsed = IssueSchema.safeParse(entry);
        return parsed.success && parsed.data.pull_request === undefined ? [parsed.data] : [];
      });
    return { issues, hasNext: /rel="next"/.test(headers.get("link") ?? "") };
  }

  async issue(fullName: string, number: number, token: string | null): Promise<GitHubIssue> {
    const { body } = await this.request(`${repoPath(fullName)}/issues/${number}`, token);
    return IssueSchema.parse(body);
  }

  async createPull(fullName: string, token: string, pull: NewPull): Promise<GitHubPull> {
    const { body } = await this.request(`${repoPath(fullName)}/pulls`, token, {
      method: "POST",
      body: pull,
    });
    return PullSchema.parse(body);
  }

  async openPullFor(fullName: string, token: string, head: string): Promise<GitHubPull | null> {
    const query = new URLSearchParams({ head, state: "open", per_page: "5" });
    const { body } = await this.request(`${repoPath(fullName)}/pulls?${query}`, token);
    const pulls = z.array(PullSchema).parse(body);
    return pulls[0] ?? null;
  }

  async pull(
    fullName: string,
    number: number,
    token: string | null,
    etag: string | null,
  ): Promise<Conditional<GitHubPull>> {
    return this.conditional(`${repoPath(fullName)}/pulls/${number}`, token, etag, PullSchema);
  }

  async checkRuns(
    fullName: string,
    sha: string,
    token: string | null,
    etag: string | null,
  ): Promise<Conditional<GitHubCheckRuns>> {
    return this.conditional(
      `${repoPath(fullName)}/commits/${encodeURIComponent(sha)}/check-runs?per_page=100`,
      token,
      etag,
      CheckRunsSchema,
    );
  }

  async combinedStatus(
    fullName: string,
    sha: string,
    token: string | null,
    etag: string | null,
  ): Promise<Conditional<GitHubCombinedStatus>> {
    return this.conditional(
      `${repoPath(fullName)}/commits/${encodeURIComponent(sha)}/status`,
      token,
      etag,
      CombinedStatusSchema,
    );
  }

  private async conditional<T>(
    path: string,
    token: string | null,
    etag: string | null,
    schema: z.ZodType<T>,
  ): Promise<Conditional<T>> {
    const { body, headers, status } = await this.request(path, token, { etag });
    if (status === 304) return { notModified: true };
    return { notModified: false, body: schema.parse(body), etag: headers.get("etag") };
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
    options: { method?: "GET" | "POST"; body?: unknown; etag?: string | null } = {},
  ): Promise<{ body: unknown; headers: Headers; status: number }> {
    const headers: Record<string, string> = {
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "onyx-agent-control",
    };
    if (token) headers.authorization = `Bearer ${token}`;
    if (options.etag) headers["if-none-match"] = options.etag;
    if (options.body !== undefined) headers["content-type"] = "application/json";
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method: options.method ?? "GET",
        headers,
        ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new GitHubError(
        502,
        interpolate(FAILURE.unreachable, {
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
    const text = await response.text();
    if (response.status === 304) return { body: null, headers: response.headers, status: 304 };
    if (!response.ok)
      throw new GitHubError(
        response.status,
        describeFailure(response.status, text, token !== null),
      );
    return {
      body: text.length > 0 ? JSON.parse(text) : null,
      headers: response.headers,
      status: response.status,
    };
  }
}
