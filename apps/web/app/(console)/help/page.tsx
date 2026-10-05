import type { Metadata } from "next";
import { GlossaryList } from "@/components/help/glossary-list";
import { HowItWorks } from "@/components/help/how-it-works";
import { HowTos } from "@/components/help/how-tos";
import { PageHeader } from "@/components/layout/page-header";
import { msg } from "@/lib/i18n/core";
import { getT } from "@/lib/i18n/server";

const CONTENTS = [
  { href: "#how-it-works", label: msg("How Onyx works") },
  { href: "#how-to", label: msg("How to") },
  { href: "#glossary", label: msg("Glossary") },
] as const;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Help") };
}

export default async function HelpPage() {
  const t = await getT();
  return (
    <>
      <PageHeader
        eyebrow={t("System")}
        title={t("Help")}
        description={t(
          "How Onyx works, the things you do most often and the meaning of every term. The ? next to a word in the console opens its definition.",
        )}
      />
      <nav aria-label={t("On this page")}>
        <ul className="flex flex-wrap gap-2">
          {CONTENTS.map((item) => (
            <li key={item.href}>
              <a
                href={item.href}
                className="inline-flex min-h-9 items-center rounded-full border border-border bg-surface-1/60 px-3 text-xs font-medium text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground"
              >
                {t(item.label)}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      <HowItWorks t={t} />
      <HowTos t={t} />
      <GlossaryList />
    </>
  );
}
