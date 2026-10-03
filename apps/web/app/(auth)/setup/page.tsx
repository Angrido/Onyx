import type { AuthStatusResponse } from "@onyx/contracts";
import { redirect } from "next/navigation";
import { CredentialsForm } from "@/components/layout/credentials-form";
import { serverFetchPublic } from "@/lib/api/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Setup" };

export default async function SetupPage() {
  const status = await serverFetchPublic<AuthStatusResponse>("/api/auth/status");
  if (status && !status.setupRequired) redirect("/login");
  return <CredentialsForm mode="setup" />;
}
