import type {
  BudgetListResponse,
  ClaudeAccountDto,
  GitHubAccountDto,
  GitIdentityDto,
  ProjectListResponse,
} from "@onyx/contracts";
import { PageHeader } from "@/components/layout/page-header";
import { BudgetsCard } from "@/components/settings/budgets-card";
import { ClaudeAccountCard } from "@/components/settings/claude-account-card";
import { GitHubAccountCard } from "@/components/settings/github-account-card";
import { GitIdentityCard } from "@/components/settings/git-identity-card";
import { serverFetch } from "@/lib/api/server";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const [claude, github, identity, budgets, projects] = await Promise.all([
    serverFetch<ClaudeAccountDto>("/api/settings/claude"),
    serverFetch<GitHubAccountDto>("/api/github/account"),
    serverFetch<GitIdentityDto>("/api/settings/git"),
    serverFetch<BudgetListResponse>("/api/budgets"),
    serverFetch<ProjectListResponse>("/api/projects"),
  ]);
  return (
    <>
      <PageHeader
        eyebrow="Settings"
        title="Accounts"
        description="Connect the Claude account your agents run with and the GitHub account Onyx clones from and pushes to."
      />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <ClaudeAccountCard initial={claude} />
        <div className="space-y-6">
          <GitHubAccountCard initial={github} />
          <GitIdentityCard initial={identity} />
        </div>
      </div>
      <BudgetsCard initial={budgets.items} projects={projects.items} />
    </>
  );
}
