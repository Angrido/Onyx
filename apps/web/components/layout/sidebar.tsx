"use client";

import type { ApprovalListResponse, ServerMessage, UserDto } from "@onyx/contracts";
import { channels } from "@onyx/contracts/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  FolderGit2,
  Gauge,
  Inbox,
  LayoutDashboard,
  LayoutGrid,
  LogOut,
  PiggyBank,
  Route,
  Search,
  Settings,
} from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback } from "react";
import { Wordmark } from "@/components/layout/brand";
import { api } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/keys";
import { formatPercent } from "@/lib/format";
import { openCommandPalette } from "@/lib/palette";
import { useQuota } from "@/lib/live";
import { QUOTA_LEVEL_STYLES, isQuotaAlert, peakUtilization } from "@/lib/quota";
import { cn } from "@/lib/utils";
import { useChannel, useConnectionState } from "@/lib/ws/context";

const NAV = [
  { href: "/", label: "Mission control", icon: LayoutDashboard },
  { href: "/projects", label: "Projects", icon: FolderGit2 },
  { href: "/agents", label: "Agent grid", icon: LayoutGrid },
  { href: "/approvals", label: "Approvals", icon: Inbox },
  { href: "/router", label: "Router", icon: Route },
  { href: "/telemetry", label: "Telemetry", icon: Activity },
  { href: "/savings", label: "Savings", icon: PiggyBank },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;

function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

const CONNECTION_STYLES = {
  open: { dot: "bg-success", label: "Live" },
  connecting: { dot: "bg-warning animate-pulse", label: "Connecting" },
  closed: { dot: "bg-destructive", label: "Offline" },
} as const;

function usePendingApprovals(): number {
  const queryClient = useQueryClient();
  const { data = 0 } = useQuery({
    queryKey: queryKeys.approvalsPending,
    queryFn: () =>
      api
        .get<ApprovalListResponse>("/api/approvals?status=PENDING&limit=1")
        .then((page) => page.pending),
  });
  const onMessage = useCallback(
    (message: ServerMessage) => {
      if (message.type === "approvals.changed")
        queryClient.setQueryData(queryKeys.approvalsPending, message.data.pending);
    },
    [queryClient],
  );
  useChannel(channels.system, onMessage);
  return data;
}

function PendingDot({ count, compact }: { count: number; compact: boolean }) {
  if (count === 0) return null;
  return (
    <motion.span
      key={count}
      initial={{ scale: 0.6, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      data-testid="approvals-badge"
      className={cn(
        "grid place-items-center rounded-full bg-warning font-semibold text-background",
        compact
          ? "absolute -right-0.5 -top-0.5 size-4 text-[9px]"
          : "relative ml-auto h-5 min-w-5 px-1.5 text-[10px]",
      )}
    >
      {count > 99 ? "99+" : count}
    </motion.span>
  );
}

const QUOTA_TEXT = {
  neutral: "text-muted-foreground",
  success: "text-success",
  warning: "text-warning",
  danger: "text-destructive",
} as const;

function QuotaIndicator({ compact }: { compact: boolean }) {
  const { data: quota } = useQuota();
  if (!quota || !isQuotaAlert(quota.level)) return null;
  const style = QUOTA_LEVEL_STYLES[quota.level];
  const peak = peakUtilization(quota);
  const label = `Claude limit: ${style.label}${peak === null ? "" : ` (${formatPercent(peak)} used)`}`;
  if (compact)
    return (
      <Link
        href="/telemetry#quota"
        aria-label={label}
        title={label}
        data-testid="quota-indicator-compact"
        className={cn("rounded-md p-1.5 min-[400px]:p-2", QUOTA_TEXT[style.tone])}
      >
        <Gauge className="size-4" />
      </Link>
    );
  return (
    <Link
      href="/telemetry#quota"
      data-testid="quota-indicator"
      className={cn(
        "flex items-center gap-2 rounded-md border border-border bg-surface-1/60 px-2.5 py-2 text-xs transition-colors hover:bg-surface-2",
        QUOTA_TEXT[style.tone],
      )}
    >
      <Gauge className="size-4 shrink-0" />
      <span className="min-w-0">
        <span className="block font-medium">{style.label}</span>
        <span className="block text-muted-foreground">
          Claude limit{peak === null ? "" : ` · ${formatPercent(peak)} used`}
        </span>
      </span>
    </Link>
  );
}

export function Sidebar({ user }: { user: UserDto }) {
  const pathname = usePathname();
  const router = useRouter();
  const connection = CONNECTION_STYLES[useConnectionState()];
  const pending = usePendingApprovals();

  async function logout() {
    await api.post("/api/auth/logout");
    router.replace("/login");
    router.refresh();
  }

  return (
    <>
      <header className="glass sticky top-0 z-30 flex items-center gap-2 border-b border-border px-4 py-2.5 md:hidden">
        <Wordmark condensed />
        <nav className="ml-auto flex items-center">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-label={item.label}
              className={cn(
                "relative rounded-md p-1.5 transition-colors min-[400px]:p-2",
                isActive(pathname, item.href)
                  ? "bg-surface-2 text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <item.icon className="size-4" />
              {item.href === "/approvals" ? <PendingDot count={pending} compact /> : null}
            </Link>
          ))}
        </nav>
        <QuotaIndicator compact />
        <span
          className={cn("size-2 shrink-0 rounded-full", connection.dot)}
          title={connection.label}
        />
        <button
          type="button"
          onClick={() => void logout()}
          className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-surface-3 hover:text-foreground"
          aria-label="Sign out"
        >
          <LogOut className="size-4" />
        </button>
      </header>
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
          Search
          <kbd className="ml-auto rounded border border-border-strong bg-surface-2 px-1.5 py-0.5 font-sans text-[10px] text-muted-foreground">
            Ctrl K
          </kbd>
        </button>
        <nav className="mt-4 flex flex-col gap-1">
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
                {item.href === "/approvals" ? <PendingDot count={pending} compact={false} /> : null}
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto space-y-3 px-2">
          <QuotaIndicator compact={false} />
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
    </>
  );
}
