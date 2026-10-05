"use client";

import type { UserDto } from "@onyx/contracts";
import { LogOut, Menu, Search, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Dialog as DialogPrimitive } from "radix-ui";
import { useEffect, useRef, useState } from "react";
import { Wordmark } from "@/components/layout/brand";
import {
  ConnectionIndicator,
  PendingBadge,
  QuotaIndicator,
  useLogout,
} from "@/components/layout/nav-parts";
import { useT } from "@/lib/i18n/client";
import { APPROVALS_HREF, inMore, isActive, mobileTabs, moreItems, navSections } from "@/lib/nav";
import { openCommandPalette } from "@/lib/palette";
import { cn } from "@/lib/utils";

const TAB =
  "relative flex min-h-14 min-w-0 flex-col items-center justify-center gap-1 px-0.5 text-[10px] font-medium leading-none tracking-tight transition-colors";

const SHEET_ROW =
  "flex min-h-11 w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-surface-3";

export function MobileNav({ user, pending }: { user: UserDto; pending: number }) {
  const t = useT();
  const pathname = usePathname();
  const logout = useLogout();
  const [open, setOpen] = useState(false);
  const moreActive = inMore(pathname);
  const searchAfterClose = useRef(false);

  useEffect(() => {
    if (!open) return;
    const desktop = window.matchMedia("(min-width: 768px)");
    const onChange = () => {
      if (desktop.matches) setOpen(false);
    };
    desktop.addEventListener("change", onChange);
    return () => desktop.removeEventListener("change", onChange);
  }, [open]);

  return (
    <>
      <header className="glass sticky top-0 z-30 flex items-center gap-1 border-b border-border py-1 pl-4 pr-2 md:hidden">
        <Wordmark condensed />
        <ConnectionIndicator className="ml-auto px-2" />
        <QuotaIndicator compact />
        <button
          type="button"
          onClick={openCommandPalette}
          aria-label={t("Search")}
          className="grid size-11 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-surface-3 hover:text-foreground"
        >
          <Search className="size-4" />
        </button>
      </header>
      <nav
        aria-label={t("Main navigation")}
        className="glass fixed inset-x-0 bottom-0 z-40 border-t border-border pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        <ul className="grid grid-cols-5">
          {mobileTabs().map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <li key={item.href} className="min-w-0">
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    TAB,
                    active ? "text-primary" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <span className="relative">
                    <item.icon className="size-5" aria-hidden="true" />
                    {item.href === APPROVALS_HREF ? (
                      <PendingBadge count={pending} compact announce={false} />
                    ) : null}
                  </span>
                  <span className="max-w-full truncate">{t(item.shortLabel)}</span>
                  {item.href === APPROVALS_HREF && pending > 0 ? (
                    <span className="sr-only">{t("{count} waiting", { count: pending })}</span>
                  ) : null}
                </Link>
              </li>
            );
          })}
          <li className="min-w-0">
            <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
              <DialogPrimitive.Trigger
                className={cn(
                  TAB,
                  "w-full",
                  moreActive ? "text-primary" : "text-muted-foreground hover:text-foreground",
                )}
                data-testid="mobile-more"
              >
                <Menu className="size-5" aria-hidden="true" />
                <span className="max-w-full truncate">{t("More")}</span>
              </DialogPrimitive.Trigger>
              <DialogPrimitive.Portal>
                <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 md:hidden" />
                <DialogPrimitive.Content
                  className="glass fixed inset-x-0 bottom-0 z-50 flex max-h-[85dvh] flex-col rounded-t-2xl border-t border-border-strong pb-[env(safe-area-inset-bottom)] shadow-2xl data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom data-[state=closed]:animate-out data-[state=closed]:slide-out-to-bottom md:hidden"
                  data-testid="mobile-more-sheet"
                  onCloseAutoFocus={(event) => {
                    if (!searchAfterClose.current) return;
                    searchAfterClose.current = false;
                    event.preventDefault();
                    openCommandPalette();
                  }}
                >
                  <div className="flex items-center gap-3 border-b border-border py-2 pl-5 pr-2">
                    <div className="min-w-0 flex-1">
                      <DialogPrimitive.Title className="text-base font-semibold tracking-tight">
                        {t("More")}
                      </DialogPrimitive.Title>
                      <DialogPrimitive.Description className="truncate text-xs text-muted-foreground">
                        {t("Other pages, search and sign out")}
                      </DialogPrimitive.Description>
                    </div>
                    <DialogPrimitive.Close
                      aria-label={t("Close")}
                      className="grid size-11 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-surface-3 hover:text-foreground"
                    >
                      <X className="size-5" />
                    </DialogPrimitive.Close>
                  </div>
                  <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
                    <button
                      type="button"
                      className={cn(SHEET_ROW, "border border-border bg-surface-1/60")}
                      onClick={() => {
                        searchAfterClose.current = true;
                        setOpen(false);
                      }}
                    >
                      <Search
                        className="size-5 shrink-0 text-muted-foreground"
                        aria-hidden="true"
                      />
                      <span className="min-w-0">
                        <span className="block text-sm font-medium">{t("Search")}</span>
                        <span className="block text-xs text-muted-foreground">
                          {t("Pages, projects, tasks and terms of the guide")}
                        </span>
                      </span>
                    </button>
                    {navSections(moreItems()).map(({ section, items }) => (
                      <div key={section.id}>
                        <p
                          id={`more-section-${section.id}`}
                          className="px-3 pb-1 text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground"
                        >
                          {t(section.label)}
                        </p>
                        <ul aria-labelledby={`more-section-${section.id}`} className="space-y-0.5">
                          {items.map((item) => {
                            const active = isActive(pathname, item.href);
                            return (
                              <li key={item.href}>
                                <Link
                                  href={item.href}
                                  aria-current={active ? "page" : undefined}
                                  onClick={() => setOpen(false)}
                                  className={cn(SHEET_ROW, active && "bg-surface-2")}
                                >
                                  <item.icon
                                    className={cn(
                                      "size-5 shrink-0",
                                      active ? "text-primary" : "text-muted-foreground",
                                    )}
                                    aria-hidden="true"
                                  />
                                  <span className="min-w-0">
                                    <span className="block text-sm font-medium">
                                      {t(item.label)}
                                    </span>
                                    <span className="block text-xs text-muted-foreground">
                                      {t(item.description)}
                                    </span>
                                  </span>
                                </Link>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    ))}
                    <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface-1 py-1 pl-3 pr-1">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{user.username}</p>
                        <p className="text-[11px] text-muted-foreground">{t("Operator")}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setOpen(false);
                          void logout();
                        }}
                        className="flex min-h-11 items-center gap-2 rounded-md px-3 text-sm text-muted-foreground transition-colors hover:bg-surface-3 hover:text-foreground"
                      >
                        <LogOut className="size-4" aria-hidden="true" />
                        {t("Sign out")}
                      </button>
                    </div>
                  </div>
                </DialogPrimitive.Content>
              </DialogPrimitive.Portal>
            </DialogPrimitive.Root>
          </li>
        </ul>
      </nav>
    </>
  );
}
