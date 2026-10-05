import type { SavingsReport } from "@onyx/contracts";
import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { SavingsDashboard } from "@/components/savings/savings-dashboard";
import { serverFetch } from "@/lib/api/server";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Savings") };
}

export default async function SavingsPage() {
  const t = await getT();
  const report = await serverFetch<SavingsReport>("/api/telemetry/savings");
  return (
    <>
      <PageHeader
        eyebrow={t("Token reduction")}
        title={t("Is Onyx saving tokens?")}
        description={t(
          "Every figure says whether it is measured on real runs or estimated. The experiment turns the estimate into a measurement.",
        )}
      />
      <SavingsDashboard initial={report} />
    </>
  );
}
