const PATH_TOKEN =
  /(?:^|[\s`'"(<[])((?:[\w@.-]+\/)*[\w@-][\w@.-]*\.[A-Za-z]{1,5})(?=$|[\s`'"),:;>\]])/g;
const SYMBOL_TOKEN = /`([A-Za-z_$][\w$]{3,})(?:\(\))?`/g;
const DEFAULT_MAX_TARGETS = 8;

export interface TargetInferenceInput {
  prompt: string;
  files: readonly string[];
  symbolFiles: ReadonlyMap<string, readonly string[]>;
  maxTargets?: number;
}

function matchPath(token: string, files: readonly string[]): string | null {
  const cleaned = token.replace(/^\.\//, "");
  if (files.includes(cleaned)) return cleaned;
  const suffix = `/${cleaned}`;
  const matches = files.filter((file) => file.endsWith(suffix));
  return matches.length === 1 ? (matches[0] ?? null) : null;
}

export function inferTargets(input: TargetInferenceInput): string[] {
  const max = input.maxTargets ?? DEFAULT_MAX_TARGETS;
  const found: string[] = [];
  const add = (relPath: string | null) => {
    if (relPath !== null && !found.includes(relPath) && found.length < max) found.push(relPath);
  };

  for (const match of input.prompt.matchAll(PATH_TOKEN))
    add(matchPath(match[1] ?? "", input.files));
  for (const match of input.prompt.matchAll(SYMBOL_TOKEN)) {
    const owners = input.symbolFiles.get(match[1] ?? "") ?? [];
    if (owners.length === 1) add(owners[0] ?? null);
  }
  return found;
}

export function expandTargetPaths(
  requested: readonly string[],
  files: readonly string[],
  rank: ReadonlyMap<string, number>,
  maxPerDirectory = 6,
): string[] {
  const result: string[] = [];
  for (const raw of requested) {
    const path = raw.trim().replace(/^\.\//, "").replace(/\/+$/, "");
    if (path.length === 0) continue;
    if (files.includes(path)) {
      if (!result.includes(path)) result.push(path);
      continue;
    }
    const inside = files
      .filter((file) => file.startsWith(`${path}/`))
      .sort((a, b) => (rank.get(b) ?? 0) - (rank.get(a) ?? 0))
      .slice(0, maxPerDirectory);
    for (const file of inside) if (!result.includes(file)) result.push(file);
  }
  return result;
}
