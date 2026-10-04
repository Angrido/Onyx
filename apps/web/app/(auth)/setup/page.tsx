import type { AuthStatusResponse } from "@onyx/contracts";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CredentialsForm } from "@/components/layout/credentials-form";
import { serverFetchPublic } from "@/lib/api/server";
import { getT } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Setup") };
}

export default async function SetupPage() {
  const status = await serverFetchPublic<AuthStatusResponse>("/api/auth/status");
  if (status && !status.setupRequired) redirect("/login");
  return <CredentialsForm mode="setup" />;
}
