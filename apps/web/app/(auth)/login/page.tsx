import type { AuthStatusResponse } from "@onyx/contracts";
import { redirect } from "next/navigation";
import { CredentialsForm } from "@/components/layout/credentials-form";
import { serverFetchPublic } from "@/lib/api/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sign in" };

export default async function LoginPage() {
  const status = await serverFetchPublic<AuthStatusResponse>("/api/auth/status");
  if (status?.setupRequired) redirect("/setup");
  return <CredentialsForm mode="login" />;
}
