import { randomUUID } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  isProcessAlive,
  processGroupOf,
  processStartTicks,
  signalProcessGroup,
  signalSandboxedGroup,
  type AgentSandbox,
  type ProcessTracker,
} from "@onyx/agent-runtime";

export interface ProcessRecord {
  pid: number;
  startTicks: string;
  label: string;
  instance: string;
  ownerPid: number;
  ownerTicks: string | null;
  sandboxed: boolean;
  startedAt: string;
}

export interface ProcessSweep {
  killed: ProcessRecord[];
  gone: number;
  kept: number;
}

export interface ProcessLedgerOptions {
  sandbox?: AgentSandbox | null;
  instance?: string;
  ownerPid?: number;
}

const RECORD_SUFFIX = ".json";

export function parseProcessRecord(text: string): ProcessRecord | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const pid = record["pid"];
  const ownerPid = record["ownerPid"];
  if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 1) return null;
  if (typeof ownerPid !== "number" || !Number.isInteger(ownerPid) || ownerPid <= 0) return null;
  if (
    typeof record["startTicks"] !== "string" ||
    typeof record["label"] !== "string" ||
    typeof record["instance"] !== "string" ||
    typeof record["sandboxed"] !== "boolean"
  )
    return null;
  return {
    pid,
    startTicks: record["startTicks"],
    label: record["label"],
    instance: record["instance"],
    ownerPid,
    ownerTicks: typeof record["ownerTicks"] === "string" ? record["ownerTicks"] : null,
    sandboxed: record["sandboxed"],
    startedAt: typeof record["startedAt"] === "string" ? record["startedAt"] : "",
  };
}

export class ProcessLedger implements ProcessTracker {
  readonly instance: string;
  private readonly ownerPid: number;
  private readonly ownerTicks: string | null;
  private readonly sandbox: AgentSandbox | null;

  constructor(
    private readonly directory: string,
    options: ProcessLedgerOptions = {},
  ) {
    this.instance = options.instance ?? randomUUID();
    this.ownerPid = options.ownerPid ?? process.pid;
    this.ownerTicks = processStartTicks(this.ownerPid);
    this.sandbox = options.sandbox ?? null;
  }

  started(pid: number, label: string): void {
    const startTicks = processStartTicks(pid);
    if (startTicks === null) return;
    const record: ProcessRecord = {
      pid,
      startTicks,
      label,
      instance: this.instance,
      ownerPid: this.ownerPid,
      ownerTicks: this.ownerTicks,
      sandboxed: this.sandbox !== null,
      startedAt: new Date().toISOString(),
    };
    try {
      mkdirSync(this.directory, { recursive: true, mode: 0o700 });
      writeFileSync(this.fileOf(pid), JSON.stringify(record), { mode: 0o600 });
    } catch {
      return;
    }
  }

  ended(pid: number): void {
    const record = this.readFile(this.fileOf(pid));
    if (record && record.instance !== this.instance) return;
    try {
      rmSync(this.fileOf(pid), { force: true });
    } catch {
      return;
    }
  }

  records(): ProcessRecord[] {
    return this.names().flatMap((name) => {
      const record = this.readFile(join(this.directory, name));
      return record ? [record] : [];
    });
  }

  async sweep(): Promise<ProcessSweep> {
    const sweep: ProcessSweep = { killed: [], gone: 0, kept: 0 };
    for (const name of this.names()) {
      const path = join(this.directory, name);
      const record = this.readFile(path);
      if (record && !this.isOrphan(record)) {
        sweep.kept += 1;
        continue;
      }
      if (record && this.isSameProcess(record)) {
        await this.kill(record);
        sweep.killed.push(record);
      } else {
        sweep.gone += 1;
      }
      rmSync(path, { force: true });
    }
    return sweep;
  }

  private names(): string[] {
    try {
      return readdirSync(this.directory).filter(
        (name) =>
          name.endsWith(RECORD_SUFFIX) && /^\d+$/.test(name.slice(0, -RECORD_SUFFIX.length)),
      );
    } catch {
      return [];
    }
  }

  private isOrphan(record: ProcessRecord): boolean {
    if (record.instance === this.instance) return false;
    if (record.ownerPid === this.ownerPid) return true;
    if (!isProcessAlive(record.ownerPid)) return true;
    return record.ownerTicks !== null && processStartTicks(record.ownerPid) !== record.ownerTicks;
  }

  private isSameProcess(record: ProcessRecord): boolean {
    if (record.pid === process.pid || record.pid === this.ownerPid) return false;
    return isProcessAlive(record.pid) && processStartTicks(record.pid) === record.startTicks;
  }

  private async kill(record: ProcessRecord): Promise<void> {
    const leader = processGroupOf(record.pid) === record.pid;
    if (record.sandboxed && this.sandbox && leader) {
      await signalSandboxedGroup(this.sandbox, record.pid, "SIGKILL");
      return;
    }
    try {
      if (leader) signalProcessGroup(record.pid, "SIGKILL");
      else process.kill(record.pid, "SIGKILL");
    } catch {
      return;
    }
  }

  private readFile(path: string): ProcessRecord | null {
    try {
      return parseProcessRecord(readFileSync(path, "utf8"));
    } catch {
      return null;
    }
  }

  private fileOf(pid: number): string {
    return join(this.directory, `${pid}${RECORD_SUFFIX}`);
  }
}
