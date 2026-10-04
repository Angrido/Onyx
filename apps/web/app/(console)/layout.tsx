import type { MeResponse } from "@onyx/contracts";
import type { ReactNode } from "react";
import { CommandPaletteLoader } from "@/components/layout/command-palette-loader";
import { Sidebar } from "@/components/layout/sidebar";
import { serverFetch } from "@/lib/api/server";
import { getT } from "@/lib/i18n/server";
import { WsProvider } from "@/lib/ws/context";

export const dynamic = "force-dynamic";

export default async function ConsoleLayout({ children }: { children: ReactNode }) {
  const { user } = await serverFetch<MeResponse>("/api/auth/me");
  const t = await getT();
  return (
    <WsProvider>
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
      >
        {t("Skip to content")}
      </a>
      <div className="flex min-h-screen flex-col md:flex-row">
        <Sidebar user={user} />
        <main
          id="main"
          tabIndex={-1}
          className="min-w-0 flex-1 px-4 py-6 outline-none md:px-8 md:py-8"
        >
          <div className="mx-auto max-w-6xl space-y-8">{children}</div>
        </main>
      </div>
      <CommandPaletteLoader />
    </WsProvider>
  );
}
