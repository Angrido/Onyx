import type {
  BackupListResponse,
  BudgetListResponse,
  ClaudeAccountDto,
  GitHubAccountDto,
  GitIdentityDto,
  MemorySettings,
  NotificationSettingsDto,
  ProjectListResponse,
  QueueDto,
  SavingsOptionsDto,
} from "@onyx/contracts";
import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { BackupsCard } from "@/components/settings/backups-card";
import { BudgetsCard } from "@/components/settings/budgets-card";
import { ClaudeAccountCard } from "@/components/settings/claude-account-card";
import { GitHubAccountCard } from "@/components/settings/github-account-card";
import { GitIdentityCard } from "@/components/settings/git-identity-card";
import { LanguageCard } from "@/components/settings/language-card";
import { MemoryCard } from "@/components/settings/memory-card";
import { NotificationsCard } from "@/components/settings/notifications-card";
import { QueueCard } from "@/components/settings/queue-card";
import { SavingsOptionsCard } from "@/components/settings/savings-options-card";
import { serverFetch } from "@/lib/api/server";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Settings") };
}

export default async function SettingsPage() {
  const t = await getT();
  const claudeRequest = serverFetch<ClaudeAccountDto>("/api/settings/claude");
  const githubRequest = serverFetch<GitHubAccountDto>("/api/github/account");
  const identityRequest = serverFetch<GitIdentityDto>("/api/settings/git");
  const budgetsRequest = serverFetch<BudgetListResponse>("/api/budgets");
  const projectsRequest = serverFetch<ProjectListResponse>("/api/projects");
  const backupsRequest = serverFetch<BackupListResponse>("/api/backups");
  const queueRequest = serverFetch<QueueDto>("/api/queue");
  const notificationsRequest = serverFetch<NotificationSettingsDto>("/api/settings/notifications");
  const memoryRequest = serverFetch<MemorySettings>("/api/settings/memory");
  const savingsOptionsRequest = serverFetch<SavingsOptionsDto>("/api/settings/savings-options");
  const [
    claude,
    github,
    identity,
    budgets,
    projects,
    backups,
    queue,
    notifications,
    memory,
    savingsOptions,
  ] = await Promise.all([
    claudeRequest,
    githubRequest,
    identityRequest,
    budgetsRequest,
    projectsRequest,
    backupsRequest,
    queueRequest,
    notificationsRequest,
    memoryRequest,
    savingsOptionsRequest,
  ]);
  return (
    <>
      <PageHeader
        eyebrow={t("Settings")}
        title={t("Accounts")}
        description={t(
          "Connect the Claude account your agents run with and the GitHub account Onyx clones from and pushes to.",
        )}
      />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <ClaudeAccountCard initial={claude} />
        <div className="space-y-6">
          <GitHubAccountCard initial={github} />
          <GitIdentityCard initial={identity} />
          <LanguageCard />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <div className="space-y-6">
          <BudgetsCard initial={budgets.items} projects={projects.items} />
          <NotificationsCard initial={notifications} />
        </div>
        <div className="space-y-6">
          <QueueCard initial={queue} />
          <MemoryCard initial={memory} />
          <SavingsOptionsCard initial={savingsOptions} />
          <BackupsCard initial={backups} />
        </div>
      </div>
    </>
  );
}
