export const MIGRATION_NAME = /^(\d{14})_([a-z0-9]+(?:_[a-z0-9]+)*)$/;
export const MIGRATION_LABEL = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;

const DAY_MS = 24 * 60 * 60 * 1000;

function pad(value: number, width = 2): string {
  return String(value).padStart(width, "0");
}

export function timestampOf(name: string): string | null {
  const match = MIGRATION_NAME.exec(name);
  if (!match?.[1]) return null;
  const stamp = match[1];
  const date = parseStamp(stamp);
  if (!date || formatStamp(date) !== stamp) return null;
  return stamp;
}

function parseStamp(stamp: string): Date | null {
  const parts = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(stamp);
  if (!parts) return null;
  const [year, month, day, hour, minute, second] = parts.slice(1).map(Number) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  return new Date(Date.UTC(year, month - 1, day, hour, minute, second));
}

function formatStamp(date: Date): string {
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`;
}

function atNine(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 9, 0, 0));
}

export function nextMigrationName(existing: readonly string[], label: string, today: Date): string {
  if (!MIGRATION_LABEL.test(label))
    throw new Error(
      `"${label}" is not a valid migration name: use lower-case letters, digits and single underscores`,
    );
  const stamps = existing.map(timestampOf).filter((stamp): stamp is string => stamp !== null);
  const last = stamps.sort().at(-1);
  const earliest = atNine(today);
  const afterLast = last ? atNine(new Date((parseStamp(last) as Date).getTime() + DAY_MS)) : null;
  const chosen = afterLast && afterLast > earliest ? afterLast : earliest;
  return `${formatStamp(chosen)}_${label}`;
}

export function cleanDiff(output: string): string {
  return output
    .split("\n")
    .filter(
      (line) => !line.trimStart().startsWith("--") && !line.startsWith("Loaded Prisma config"),
    )
    .join("\n")
    .trim();
}

export function migrationProblems(
  onDisk: readonly string[],
  addedInCommits: readonly (readonly string[])[],
): string[] {
  const problems: string[] = [];
  const sorted = [...onDisk].sort();
  let previous: string | null = null;
  for (const name of sorted) {
    const stamp = timestampOf(name);
    if (!stamp) {
      problems.push(`${name}: the name must be YYYYMMDDHHMMSS_lower_snake_case with a real date`);
      continue;
    }
    if (previous !== null && stamp <= previous)
      problems.push(`${name}: the timestamp ${stamp} is not after the previous migration's`);
    previous = stamp;
  }
  const present = new Set(onDisk);
  const committed = new Set<string>();
  const groups: string[][] = [];
  for (const group of addedInCommits) {
    const added = group.filter((name) => present.has(name) && !committed.has(name));
    for (const name of added) committed.add(name);
    groups.push(added);
  }
  groups.push(onDisk.filter((name) => !committed.has(name)));
  let highest: string | null = null;
  for (const group of groups) {
    for (const name of group)
      if (highest !== null && name <= highest)
        problems.push(
          `${name}: added after ${highest} but sorts before it, so a new install would apply them in another order (name it after the last migration: pnpm --filter @onyx/db migrate:new <name>)`,
        );
    for (const name of group) if (highest === null || name > highest) highest = name;
  }
  return problems;
}
