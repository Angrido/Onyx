import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Providers } from "@/components/providers";
import { getLocale, getT } from "@/lib/i18n/server";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return {
    title: { default: "Onyx", template: "%s · Onyx" },
    description: t("Orchestration console for Claude Code agents"),
  };
}

export const viewport: Viewport = {
  themeColor: "#0b0b10",
  colorScheme: "dark",
  viewportFit: "cover",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale();
  return (
    <html lang={locale} className="dark">
      <body>
        <Providers locale={locale}>{children}</Providers>
      </body>
    </html>
  );
}
