"use client";

import type { UserDto } from "@onyx/contracts";
import { LogOut, Search } from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Wordmark } from "@/components/layout/brand";
import { MobileNav } from "@/components/layout/mobile-nav";
import {
  ConnectionIndicator,
  PendingBadge,
  QuotaIndicator,
  useLogout,
  usePendingApprovals,
} from "@/components/layout/nav-parts";
import { useT } from "@/lib/i18n/client";
import { APPROVALS_HREF, isActive, navSections } from "@/lib/nav";
import { openCommandPalette } from "@/lib/palette";
import { cn } from "@/lib/utils";

export function Sidebar({ user }: { user: UserDto }) {
  const t = useT();
  const pathname = usePathname();
  const pending = usePendingApprovals();
  const logout = useLogout();

  return (
    <>
      <MobileNav user={user} pending={pending} />
      <aside className="glass sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-border px-3 py-5 md:flex">
        <div className="px-2">
          <Wordmark />
        </div>
        <button
          type="button"
          onClick={openCommandPalette}
          className="mt-6 flex items-center gap-2 rounded-md border border-border bg-surface-1/60 px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
          data-testid="open-palette"
        >
          <Search className="size-4" />
          {t("Search")}
          <kbd className="ml-auto rounded border border-border-strong bg-surface-2 px-1.5 py-0.5 font-sans text-[10px] text-muted-foreground">
            {"Ctrl K"}
          </kbd>
        </button>
        <nav
          aria-label={t("Main navigation")}
          className="-mx-1 mt-4 min-h-0 flex-1 space-y-4 overflow-y-auto px-1 pb-4"
        >
          {navSections().map(({ section, items }) => (
            <div key={section.id}>
              <p
                id={`nav-section-${section.id}`}
                className="px-3 pb-1 text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground"
              >
                {t(section.label)}
              </p>
              <ul aria-labelledby={`nav-section-${section.id}`} className="flex flex-col gap-0.5">
                {items.map((item) => {
                  const active = isActive(pathname, item.href);
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        title={t(item.description)}
                        aria-current={active ? "page" : undefined}
                        className={cn(
                          "relative flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                          active
                            ? "text-foreground"
                            : "text-muted-foreground hover:text-foreground",
                        )}
                      >
                        {active ? (
                          <motion.span
                            layoutId="nav-active"
                            className="absolute inset-0 rounded-md border border-border-strong bg-surface-2"
                            transition={{ type: "spring", stiffness: 420, damping: 34 }}
                          />
                        ) : null}
                        <item.icon className="relative size-4" aria-hidden="true" />
                        <span className="relative">{t(item.label)}</span>
                        {item.href === APPROVALS_HREF ? (
                          <PendingBadge count={pending} compact={false} />
                        ) : null}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>
        <div className="space-y-3 px-2">
          <QuotaIndicator compact={false} />
          <ConnectionIndicator />
          <div className="flex items-center justify-between rounded-lg border border-border bg-surface-1 px-3 py-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{user.username}</p>
              <p className="text-[11px] text-muted-foreground">{t("Operator")}</p>
            </div>
            <button
              type="button"
              onClick={() => void logout()}
              className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-surface-3 hover:text-foreground"
              aria-label={t("Sign out")}
            >
              <LogOut className="size-4" />
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
