import { readFileSync } from "node:fs";

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code: unknown }).code)
    : undefined;
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return errorCode(error) === "EPERM";
  }
}

export function isProcessGroupAlive(pgid: number): boolean {
  try {
    process.kill(-pgid, 0);
    return true;
  } catch (error) {
    return errorCode(error) === "EPERM";
  }
}

export function signalProcessGroup(pgid: number, signal: NodeJS.Signals): boolean {
  try {
    process.kill(-pgid, signal);
    return true;
  } catch (error) {
    if (errorCode(error) === "ESRCH") return false;
    throw error;
  }
}

export function readProcessCommandLine(pid: number): string[] | null {
  try {
    return readFileSync(`/proc/${pid}/cmdline`, "utf8")
      .split("\0")
      .filter((part) => part.length > 0);
  } catch {
    return null;
  }
}

export function terminateStaleProcess(pid: number, expectedFragment: string): boolean {
  const commandLine = readProcessCommandLine(pid);
  if (commandLine === null) return false;
  if (!commandLine.some((part) => part.includes(expectedFragment))) return false;
  signalProcessGroup(pid, "SIGKILL");
  return true;
}

export interface ProcessTracker {
  started(pid: number, label: string): void;
  ended(pid: number): void;
}

function statFields(pid: number): string[] | null {
  let stat: string;
  try {
    stat = readFileSync(`/proc/${pid}/stat`, "utf8");
  } catch {
    return null;
  }
  return stat
    .slice(stat.lastIndexOf(")") + 1)
    .trim()
    .split(/\s+/);
}

export function processStartTicks(pid: number): string | null {
  return statFields(pid)?.[19] ?? null;
}

export function processGroupOf(pid: number): number | null {
  const group = Number(statFields(pid)?.[2]);
  return Number.isInteger(group) && group > 0 ? group : null;
}
