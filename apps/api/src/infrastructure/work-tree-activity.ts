const KEEP_MS = 60 * 60_000;

interface Activity {
  root: string;
  workspace: string;
  start: number;
  end: number | null;
}

export class WorkTreeActivity {
  private nextToken = 1;
  private readonly activities = new Map<number, Activity>();

  constructor(private readonly now: () => number = Date.now) {}

  begin(root: string, workspace: string): number {
    const token = this.nextToken++;
    this.activities.set(token, { root, workspace, start: this.now(), end: null });
    return token;
  }

  end(token: number): void {
    const activity = this.activities.get(token);
    if (activity) activity.end = this.now();
    const horizon = this.now() - KEEP_MS;
    for (const [key, entry] of this.activities)
      if (entry.end !== null && entry.end < horizon) this.activities.delete(key);
  }

  concurrent(token: number): Set<string> {
    const own = this.activities.get(token);
    const names = new Set<string>();
    if (!own) return names;
    for (const [key, entry] of this.activities) {
      if (key === token || entry.root !== own.root || entry.workspace === own.workspace) continue;
      if (entry.end !== null && entry.end < own.start) continue;
      names.add(entry.workspace);
    }
    return names;
  }
}
