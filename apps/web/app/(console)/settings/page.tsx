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
import { Fragment, type ReactNode } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { BackupsCard } from "@/components/settings/backups-card";
import { BudgetsCard } from "@/components/settings/budgets-card";
import { ClaudeAccountCard } from "@/components/settings/claude-account-card";
import { DiagnosticsCard } from "@/components/settings/diagnostics-card";
import { GitHubAccountCard } from "@/components/settings/github-account-card";
import { GitIdentityCard } from "@/components/settings/git-identity-card";
import { LanguageCard } from "@/components/settings/language-card";
import { MemoryCard } from "@/components/settings/memory-card";
import { NotificationsCard } from "@/components/settings/notifications-card";
import { QueueCard } from "@/components/settings/queue-card";
import { SavingsOptionsCard } from "@/components/settings/savings-options-card";
import { SettingsIndex } from "@/components/settings/settings-index";
import { serverFetch } from "@/lib/api/server";
import { getT } from "@/lib/i18n/server";
import { SETTINGS_SECTIONS, type SettingsCardId } from "@/lib/settings-sections";

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
  const cards: Record<SettingsCardId, ReactNode> = {
    claude: <ClaudeAccountCard initial={claude} />,
    github: <GitHubAccountCard initial={github} />,
    "git-identity": <GitIdentityCard initial={identity} />,
    language: <LanguageCard />,
    budgets: <BudgetsCard initial={budgets.items} projects={projects.items} />,
    queue: <QueueCard initial={queue} />,
    notifications: <NotificationsCard initial={notifications} />,
    memory: <MemoryCard initial={memory} />,
    "savings-options": <SavingsOptionsCard initial={savingsOptions} />,
    backups: <BackupsCard initial={backups} />,
    diagnostics: <DiagnosticsCard />,
  };
  return (
    <>
      <PageHeader
        title={t("Settings")}
        description={t(
          "Accounts, language, spending, notifications, token saving and maintenance. Use the index to jump to a section.",
        )}
      />
      <div className="grid min-w-0 grid-cols-1 gap-6 lg:grid-cols-[11rem_minmax(0,1fr)] lg:gap-8">
        <SettingsIndex />
        <div className="min-w-0 space-y-10">
          {SETTINGS_SECTIONS.map((section) => (
            <section
              key={section.id}
              id={section.id}
              aria-labelledby={`${section.id}-title`}
              className="min-w-0 scroll-mt-20 space-y-4 md:scroll-mt-8 [&_[id]]:scroll-mt-20 md:[&_[id]]:scroll-mt-8"
            >
              <div className="space-y-1">
                <h2 id={`${section.id}-title`} className="text-lg font-semibold tracking-tight">
                  {t(section.label)}
                </h2>
                <p className="text-sm text-muted-foreground">{t(section.description)}</p>
              </div>
              <div
                className={
                  section.cards.length > 1
                    ? "grid grid-cols-1 gap-6 2xl:grid-cols-2 2xl:items-start"
                    : "grid grid-cols-1 gap-6"
                }
              >
                {section.cards.map((card) => (
                  <Fragment key={card}>{cards[card]}</Fragment>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </>
  );
}
