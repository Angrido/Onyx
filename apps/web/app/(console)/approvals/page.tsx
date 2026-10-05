import type { ApprovalListResponse } from "@onyx/contracts";
import type { Metadata } from "next";
import { ApprovalsCenter } from "@/components/approvals/approvals-center";
import { PageHeader } from "@/components/layout/page-header";
import { serverFetch } from "@/lib/api/server";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Approvals") };
}

export default async function ApprovalsPage() {
  const t = await getT();
  const approvals = await serverFetch<ApprovalListResponse>("/api/approvals?limit=60");
  return (
    <>
      <PageHeader
        eyebrow={t("Approvals")}
        title={t("Decisions")}
        description={t(
          "Onyx stops here before anything irreversible: running a plan, resolving a merge conflict, or spending past a soft budget.",
        )}
      />
      <ApprovalsCenter initial={approvals} />
    </>
  );
}
