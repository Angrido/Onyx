import type {
  BackupListResponse,
  BudgetListResponse,
  ClaudeAccountDto,
  GitHubAccountDto,
  GitIdentityDto,
  ProjectListResponse,
  QueueDto,
} from "@onyx/contracts";
import { PageHeader } from "@/components/layout/page-header";
import { BackupsCard } from "@/components/settings/backups-card";
import { BudgetsCard } from "@/components/settings/budgets-card";
import { ClaudeAccountCard } from "@/components/settings/claude-account-card";
import { GitHubAccountCard } from "@/components/settings/github-account-card";
import { GitIdentityCard } from "@/components/settings/git-identity-card";
import { QueueCard } from "@/components/settings/queue-card";
import { serverFetch } from "@/lib/api/server";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const [claude, github, identity, budgets, projects, backups, queue] = await Promise.all([
    serverFetch<ClaudeAccountDto>("/api/settings/claude"),
    serverFetch<GitHubAccountDto>("/api/github/account"),
    serverFetch<GitIdentityDto>("/api/settings/git"),
    serverFetch<BudgetListResponse>("/api/budgets"),
    serverFetch<ProjectListResponse>("/api/projects"),
    serverFetch<BackupListResponse>("/api/backups"),
    serverFetch<QueueDto>("/api/queue"),
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
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <BudgetsCard initial={budgets.items} projects={projects.items} />
        <div className="space-y-6">
          <QueueCard initial={queue} />
          <BackupsCard initial={backups} />
        </div>
      </div>
    </>
  );
}
