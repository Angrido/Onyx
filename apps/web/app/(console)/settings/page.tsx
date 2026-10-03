import type { ClaudeAccountDto, GitHubAccountDto } from "@onyx/contracts";
import { PageHeader } from "@/components/layout/page-header";
import { ClaudeAccountCard } from "@/components/settings/claude-account-card";
import { GitHubAccountCard } from "@/components/settings/github-account-card";
import { serverFetch } from "@/lib/api/server";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const [claude, github] = await Promise.all([
    serverFetch<ClaudeAccountDto>("/api/settings/claude"),
    serverFetch<GitHubAccountDto>("/api/github/account"),
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
        <GitHubAccountCard initial={github} />
      </div>
    </>
  );
}
