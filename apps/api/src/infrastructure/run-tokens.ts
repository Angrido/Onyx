import { randomBytes } from "node:crypto";
import type { ContextPolicy, PathGuard, WriteFence } from "@onyx/ignore-compiler";
import type { TestGuard } from "../domain/tdd/test-guard";

export interface RunScopeGrant {
  workspaceId: string | null;
  policy: ContextPolicy;
  guard: PathGuard;
  fence: WriteFence | null;
  tests?: TestGuard | null;
}

export interface RunGrant extends RunScopeGrant {
  runId: string;
  projectId: string;
  calls: number;
  tokens: number;
  expiresAt: number;
}

export const RUN_TOKEN_TTL_MS = 12 * 3_600_000;

export class RunTokenRegistry {
  private readonly grants = new Map<string, RunGrant>();
  private readonly tokensByRun = new Map<string, string>();

  constructor(
    private readonly ttlMs: number = RUN_TOKEN_TTL_MS,
    private readonly now: () => number = Date.now,
  ) {}

  issue(runId: string, projectId: string, scope: RunScopeGrant): string {
    this.revoke(runId);
    const token = randomBytes(32).toString("base64url");
    this.grants.set(token, {
      runId,
      projectId,
      ...scope,
      calls: 0,
      tokens: 0,
      expiresAt: this.now() + this.ttlMs,
    });
    this.tokensByRun.set(runId, token);
    return token;
  }

  resolve(token: string): RunGrant | null {
    const grant = this.grants.get(token);
    if (!grant) return null;
    if (grant.expiresAt <= this.now()) {
      this.revoke(grant.runId);
      return null;
    }
    return grant;
  }

  record(token: string, tokens: number): void {
    const grant = this.grants.get(token);
    if (!grant) return;
    grant.calls += 1;
    grant.tokens += tokens;
  }

  usage(runId: string): { calls: number; tokens: number } {
    const token = this.tokensByRun.get(runId);
    const grant = token === undefined ? undefined : this.grants.get(token);
    return { calls: grant?.calls ?? 0, tokens: grant?.tokens ?? 0 };
  }

  revoke(runId: string): void {
    const token = this.tokensByRun.get(runId);
    if (token !== undefined) this.grants.delete(token);
    this.tokensByRun.delete(runId);
  }
}
