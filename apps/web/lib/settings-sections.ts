import { msg } from "@/lib/i18n/core";

export const SETTINGS_CARDS = [
  "claude",
  "github",
  "git-identity",
  "language",
  "budgets",
  "queue",
  "notifications",
  "memory",
  "savings-options",
  "backups",
  "diagnostics",
] as const;

export type SettingsCardId = (typeof SETTINGS_CARDS)[number];

export interface SettingsSection {
  id: string;
  label: string;
  description: string;
  cards: readonly SettingsCardId[];
}

export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  {
    id: "section-account",
    label: msg("Accounts"),
    description: msg(
      "Who Onyx works as: the Claude account of the agents, the GitHub account of the repositories and the author of the commits.",
    ),
    cards: ["claude", "github", "git-identity"],
  },
  {
    id: "section-interface",
    label: msg("Interface"),
    description: msg("How the console speaks to you on this browser."),
    cards: ["language"],
  },
  {
    id: "section-spending",
    label: msg("Spending and queue"),
    description: msg("How much Onyx may spend and how many agents work at the same time."),
    cards: ["budgets", "queue"],
  },
  {
    id: "section-notifications",
    label: msg("Notifications"),
    description: msg("Where Onyx tells you that something needs you, even away from the screen."),
    cards: ["notifications"],
  },
  {
    id: "section-savings",
    label: msg("Token saving"),
    description: msg("What Onyx does to make Claude read and write less."),
    cards: ["memory", "savings-options"],
  },
  {
    id: "section-maintenance",
    label: msg("Maintenance"),
    description: msg("Copies of the database and a file to send when you ask for help."),
    cards: ["backups", "diagnostics"],
  },
];

export function sectionForAnchor(anchor: string): SettingsSection | null {
  const id = anchor.replace(/^#/, "");
  return (
    SETTINGS_SECTIONS.find(
      (section) => section.id === id || section.cards.some((card) => card === id),
    ) ?? null
  );
}

export function activeSection(
  tops: readonly { id: string; top: number }[],
  offset: number,
): string | null {
  let current: string | null = tops[0]?.id ?? null;
  for (const entry of tops) if (entry.top <= offset) current = entry.id;
  return current;
}

export const QUEUE_SEARCH_THRESHOLD = 10;

export interface QueueProjectRow {
  projectId: string;
  projectName: string;
  ownLimit: number | null;
}

function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

export function visibleQueueProjects<T extends QueueProjectRow>(
  projects: readonly T[],
  options: { showAll: boolean; query: string; keep?: ReadonlySet<string> },
): T[] {
  if (!options.showAll)
    return projects.filter(
      (project) => project.ownLimit !== null || (options.keep?.has(project.projectId) ?? false),
    );
  const query = normalize(options.query);
  if (!query) return [...projects];
  return projects.filter((project) => normalize(project.projectName).includes(query));
}

export const RECENT_BACKUPS = 3;

export function visibleBackups<T extends { createdAt: string }>(
  items: readonly T[],
  showAll: boolean,
  limit: number = RECENT_BACKUPS,
): { shown: T[]; hidden: number } {
  const sorted = [...items].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  if (showAll || sorted.length <= limit) return { shown: sorted, hidden: 0 };
  return { shown: sorted.slice(0, limit), hidden: sorted.length - limit };
}
