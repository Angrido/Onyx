import type { ApprovalListResponse } from "@onyx/contracts";
import { ApprovalsCenter } from "@/components/approvals/approvals-center";
import { PageHeader } from "@/components/layout/page-header";
import { serverFetch } from "@/lib/api/server";

export const metadata = { title: "Approvals" };

export default async function ApprovalsPage() {
  const approvals = await serverFetch<ApprovalListResponse>("/api/approvals?limit=60");
  return (
    <>
      <PageHeader
        eyebrow="Approvals"
        title="Decisions"
        description="Onyx stops here before anything irreversible: running a plan, resolving a merge conflict, or spending past a soft budget."
      />
      <ApprovalsCenter initial={approvals} />
    </>
  );
}
