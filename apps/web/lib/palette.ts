import { GLOSSARY } from "@/lib/glossary";
import { msg } from "@/lib/i18n/core";
import { HELP_HREF } from "@/lib/nav";

export const OPEN_PALETTE_EVENT = "onyx:command-palette";

export function openCommandPalette(): void {
  window.dispatchEvent(new Event(OPEN_PALETTE_EVENT));
}

export function isPaletteShortcut(event: {
  key?: unknown;
  metaKey?: boolean;
  ctrlKey?: boolean;
}): boolean {
  if (typeof event.key !== "string") return false;
  return event.key.toLowerCase() === "k" && (event.metaKey === true || event.ctrlKey === true);
}

export interface PaletteLink {
  id: string;
  label: string;
  href: string;
}

export const CREATE_LINKS: readonly PaletteLink[] = [
  { id: "new-local", label: msg("Add a project from a folder"), href: "/projects?new=local" },
  { id: "new-github", label: msg("Import a project from GitHub"), href: "/projects?new=github" },
];

export const SETTINGS_LINKS: readonly PaletteLink[] = [
  { id: "claude", label: msg("Claude account"), href: "/settings#claude" },
  { id: "github", label: msg("GitHub token"), href: "/settings#github" },
  { id: "language", label: msg("Interface language"), href: "/settings#language" },
  { id: "budgets", label: msg("Budgets"), href: "/settings#budgets" },
  { id: "notifications", label: msg("Notifications"), href: "/settings#notifications" },
  { id: "queue", label: msg("Run queue"), href: "/settings#queue" },
  { id: "memory", label: msg("Project memory"), href: "/settings#memory" },
  { id: "savings-options", label: msg("Token saving options"), href: "/settings#savings-options" },
  { id: "backups", label: msg("Backups"), href: "/settings#backups" },
  { id: "diagnostics", label: msg("Diagnostics"), href: "/settings#diagnostics" },
];

export const PROJECT_PAGES: readonly { suffix: string; label: string }[] = [
  { suffix: "/insights", label: msg("Insights") },
  { suffix: "/github", label: msg("GitHub") },
  { suffix: "/memory", label: msg("Memory") },
  { suffix: "/graph", label: msg("Graph") },
  { suffix: "/surgeon", label: msg("Context Surgeon") },
];

export const GLOSSARY_LINKS: readonly (PaletteLink & { definition: string })[] = GLOSSARY.map(
  (entry) => ({
    id: entry.id,
    label: entry.term,
    definition: entry.definition,
    href: `${HELP_HREF}#${entry.id}`,
  }),
);
