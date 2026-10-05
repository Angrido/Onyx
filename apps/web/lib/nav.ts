import {
  Activity,
  CircleHelp,
  FolderGit2,
  Inbox,
  LayoutDashboard,
  LayoutGrid,
  PiggyBank,
  Route,
  ScrollText,
  Settings,
  type LucideIcon,
} from "lucide-react";
import { msg } from "@/lib/i18n/core";

export type NavSectionId = "work" | "analysis" | "system";

export interface NavItem {
  href: string;
  label: string;
  shortLabel: string;
  description: string;
  icon: LucideIcon;
  section: NavSectionId;
}

export interface NavSection {
  id: NavSectionId;
  label: string;
}

export const APPROVALS_HREF = "/approvals";
export const HELP_HREF = "/help";

export const NAV_SECTIONS: readonly NavSection[] = [
  { id: "work", label: msg("Work") },
  { id: "analysis", label: msg("Analysis") },
  { id: "system", label: msg("System") },
];

export const NAV_ITEMS: readonly NavItem[] = [
  {
    href: "/",
    label: msg("Mission control"),
    shortLabel: msg("Overview"),
    description: msg("Every project at a glance: what is running, waiting or needs you"),
    icon: LayoutDashboard,
    section: "work",
  },
  {
    href: "/projects",
    label: msg("Projects"),
    shortLabel: msg("Projects"),
    description: msg("Your repositories with their tasks, plans and workspaces"),
    icon: FolderGit2,
    section: "work",
  },
  {
    href: "/agents",
    label: msg("Agents"),
    shortLabel: msg("Agents"),
    description: msg("Runs in progress and terminals, side by side"),
    icon: LayoutGrid,
    section: "work",
  },
  {
    href: APPROVALS_HREF,
    label: msg("Approvals"),
    shortLabel: msg("Approvals"),
    description: msg("Decisions waiting for you before Onyx goes on"),
    icon: Inbox,
    section: "work",
  },
  {
    href: "/savings",
    label: msg("Savings"),
    shortLabel: msg("Savings"),
    description: msg("How many tokens Onyx saved, measured or estimated"),
    icon: PiggyBank,
    section: "analysis",
  },
  {
    href: "/telemetry",
    label: msg("Usage"),
    shortLabel: msg("Usage"),
    description: msg("Tokens, costs and Claude limits over time"),
    icon: Activity,
    section: "analysis",
  },
  {
    href: "/router",
    label: msg("Models"),
    shortLabel: msg("Models"),
    description: msg("Which Claude model each run uses, and why"),
    icon: Route,
    section: "analysis",
  },
  {
    href: "/logs",
    label: msg("Logs"),
    shortLabel: msg("Logs"),
    description: msg("What Onyx did, with errors and details"),
    icon: ScrollText,
    section: "system",
  },
  {
    href: "/settings",
    label: msg("Settings"),
    shortLabel: msg("Settings"),
    description: msg("Claude account, GitHub, budgets, notifications and backups"),
    icon: Settings,
    section: "system",
  },
  {
    href: HELP_HREF,
    label: msg("Help"),
    shortLabel: msg("Help"),
    description: msg("How Onyx works, short how-tos and the glossary"),
    icon: CircleHelp,
    section: "system",
  },
];

export const MOBILE_TABS: readonly string[] = ["/", "/projects", APPROVALS_HREF, "/agents"];

export function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

export function navSections(
  items: readonly NavItem[] = NAV_ITEMS,
): { section: NavSection; items: NavItem[] }[] {
  return NAV_SECTIONS.map((section) => ({
    section,
    items: items.filter((item) => item.section === section.id),
  })).filter((group) => group.items.length > 0);
}

export function mobileTabs(): NavItem[] {
  return MOBILE_TABS.map((href) => NAV_ITEMS.find((item) => item.href === href)).filter(
    (item): item is NavItem => item !== undefined,
  );
}

export function moreItems(): NavItem[] {
  return NAV_ITEMS.filter((item) => !MOBILE_TABS.includes(item.href));
}

export function inMore(pathname: string): boolean {
  return moreItems().some((item) => isActive(pathname, item.href));
}

export function badgeText(count: number): string {
  return count > 99 ? "99+" : String(count);
}
