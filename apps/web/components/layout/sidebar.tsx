"use client";

import type { UserDto } from "@onyx/contracts";
import { Activity, FolderGit2, LayoutDashboard, LogOut } from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Wordmark } from "@/components/layout/brand";
import { api } from "@/lib/api/client";
import { cn } from "@/lib/utils";
import { useConnectionState } from "@/lib/ws/context";

const NAV = [
  { href: "/", label: "Console", icon: LayoutDashboard },
  { href: "/projects", label: "Projects", icon: FolderGit2 },
  { href: "/telemetry", label: "Telemetry", icon: Activity },
] as const;

function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

const CONNECTION_STYLES = {
  open: { dot: "bg-success", label: "Live" },
  connecting: { dot: "bg-warning animate-pulse", label: "Connecting" },
  closed: { dot: "bg-destructive", label: "Offline" },
} as const;

export function Sidebar({ user }: { user: UserDto }) {
  const pathname = usePathname();
  const router = useRouter();
  const connection = CONNECTION_STYLES[useConnectionState()];

  async function logout() {
    await api.post("/api/auth/logout");
    router.replace("/login");
    router.refresh();
  }

  return (
    <aside className="glass sticky top-0 flex h-screen w-60 shrink-0 flex-col border-r border-border px-3 py-5">
      <div className="px-2">
        <Wordmark />
      </div>
      <nav className="mt-8 flex flex-col gap-1">
        {NAV.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "relative flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {active ? (
                <motion.span
                  layoutId="nav-active"
                  className="absolute inset-0 rounded-md border border-border-strong bg-surface-2"
                  transition={{ type: "spring", stiffness: 420, damping: 34 }}
                />
              ) : null}
              <item.icon className="relative size-4" />
              <span className="relative">{item.label}</span>
            </Link>
          );
        })}
      </nav>
      <div className="mt-auto space-y-3 px-2">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className={cn("size-2 rounded-full", connection.dot)} />
          {connection.label}
        </div>
        <div className="flex items-center justify-between rounded-lg border border-border bg-surface-1 px-3 py-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{user.username}</p>
            <p className="text-[11px] text-muted-foreground">Operator</p>
          </div>
          <button
            type="button"
            onClick={() => void logout()}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-surface-3 hover:text-foreground"
            aria-label="Sign out"
          >
            <LogOut className="size-4" />
          </button>
        </div>
      </div>
    </aside>
  );
}
