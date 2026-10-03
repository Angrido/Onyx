import { randomBytes } from "node:crypto";
import type { ContextPolicy, PathGuard, WriteFence } from "@onyx/ignore-compiler";

export interface RunScopeGrant {
  workspaceId: string | null;
  policy: ContextPolicy;
  guard: PathGuard;
  fence: WriteFence | null;
}

export interface RunGrant extends RunScopeGrant {
  runId: string;
  projectId: string;
  calls: number;
  tokens: number;
}

export class RunTokenRegistry {
  private readonly grants = new Map<string, RunGrant>();
  private readonly tokensByRun = new Map<string, string>();

  issue(runId: string, projectId: string, scope: RunScopeGrant): string {
    this.revoke(runId);
    const token = randomBytes(32).toString("base64url");
    this.grants.set(token, { runId, projectId, ...scope, calls: 0, tokens: 0 });
    this.tokensByRun.set(runId, token);
    return token;
  }

  resolve(token: string): RunGrant | null {
    return this.grants.get(token) ?? null;
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
