import type { MeResponse } from "@onyx/contracts";
import type { ReactNode } from "react";
import { Sidebar } from "@/components/layout/sidebar";
import { serverFetch } from "@/lib/api/server";
import { WsProvider } from "@/lib/ws/context";

export const dynamic = "force-dynamic";

export default async function ConsoleLayout({ children }: { children: ReactNode }) {
  const { user } = await serverFetch<MeResponse>("/api/auth/me");
  return (
    <WsProvider>
      <div className="flex min-h-screen flex-col md:flex-row">
        <Sidebar user={user} />
        <main className="min-w-0 flex-1 px-4 py-6 md:px-8 md:py-8">
          <div className="mx-auto max-w-6xl space-y-8">{children}</div>
        </main>
      </div>
    </WsProvider>
  );
}
