import type { SavingsReport } from "@onyx/contracts";
import { PageHeader } from "@/components/layout/page-header";
import { SavingsDashboard } from "@/components/savings/savings-dashboard";
import { serverFetch } from "@/lib/api/server";

export const metadata = { title: "Savings" };

export default async function SavingsPage() {
  const report = await serverFetch<SavingsReport>("/api/telemetry/savings");
  return (
    <>
      <PageHeader
        eyebrow="Token reduction"
        title="Is Onyx saving tokens?"
        description="Every figure says whether it is measured on real runs or estimated. The experiment turns the estimate into a measurement."
      />
      <SavingsDashboard initial={report} />
    </>
  );
}
