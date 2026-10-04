import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { chmod, chown, lstat, mkdir, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { AgentSandbox } from "@onyx/agent-runtime";
import type { AppConfig } from "../config";

export interface SandboxCheck {
  ok: boolean;
  detail: string;
}

export function groupIdOf(name: string, groupFile = "/etc/group"): number | null {
  let text: string;
  try {
    text = readFileSync(groupFile, "utf8");
  } catch {
    return null;
  }
  for (const line of text.split("\n")) {
    const [group, , gid] = line.split(":");
    if (group === name && gid !== undefined && /^\d+$/.test(gid)) return Number(gid);
  }
  return null;
}

export function sandboxDirectories(
  config: Pick<AppConfig, "dataDir" | "runtimeDir" | "worktreesDir" | "projectsDir">,
): { path: string; mode: number }[] {
  return [
    { path: config.dataDir, mode: 0o710 },
    { path: config.runtimeDir, mode: 0o2750 },
    { path: join(config.runtimeDir, "tdd"), mode: 0o2750 },
    { path: config.worktreesDir, mode: 0o2770 },
    { path: config.projectsDir, mode: 0o2770 },
  ];
}

function sudoWorks(sandbox: AgentSandbox): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      sandbox.sudo,
      ["-n", "-u", sandbox.user, "--", "/bin/sh", "-c", 'test -w "$1"', "onyx-agent", sandbox.home],
      { timeout: 10_000, env: { PATH: process.env.PATH ?? "/usr/bin:/bin" } },
      (error, _stdout, stderr) => {
        if (!error) resolve(null);
        else
          resolve(
            String(stderr).trim().split("\n").at(-1) ||
              `${sandbox.user} cannot write its home ${sandbox.home}`,
          );
      },
    );
  });
}

export async function prepareAgentSandbox(
  config: Pick<
    AppConfig,
    "dataDir" | "runtimeDir" | "worktreesDir" | "projectsDir" | "agentSandbox"
  >,
): Promise<SandboxCheck> {
  const sandbox = config.agentSandbox;
  if (!sandbox) return { ok: true, detail: "off: agents run as the Onyx user" };
  const gid = groupIdOf(sandbox.group);
  if (gid === null) return { ok: false, detail: `group ${sandbox.group} does not exist` };
  for (const directory of sandboxDirectories(config)) {
    try {
      await mkdir(directory.path, { recursive: true });
      const info = await stat(directory.path);
      if (info.gid !== gid) await chown(directory.path, -1, gid);
      if ((info.mode & 0o7777) !== directory.mode) await chmod(directory.path, directory.mode);
    } catch (error) {
      return {
        ok: false,
        detail: `cannot share ${directory.path} with ${sandbox.group}: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
  const problem = await sudoWorks(sandbox);
  if (problem !== null) return { ok: false, detail: `sudo to ${sandbox.user} failed: ${problem}` };
  return { ok: true, detail: `agents run as ${sandbox.user}` };
}

export interface ShareReport {
  shared: number;
  failed: number;
}

export function sharedMode(mode: number, directory: boolean, metadata: boolean): number {
  const owner = mode & 0o7707;
  if (directory) return owner | 0o2000 | (metadata ? 0o050 : 0o070);
  const execute = (mode & 0o100) !== 0 ? 0o010 : 0;
  return owner | execute | (metadata ? 0o040 : 0o060);
}

async function shareEntry(path: string, gid: number, metadata: boolean, report: ShareReport) {
  const info = await lstat(path).catch(() => null);
  if (!info || info.isSymbolicLink()) return;
  const mode = sharedMode(info.mode, info.isDirectory(), metadata);
  try {
    if (info.gid !== gid) await chown(path, -1, gid);
    if ((info.mode & 0o7777) !== mode) await chmod(path, mode);
    report.shared += 1;
  } catch {
    report.failed += 1;
  }
  if (!info.isDirectory()) return;
  const entries = await readdir(path).catch(() => []);
  for (const entry of entries)
    await shareEntry(join(path, entry), gid, metadata || entry === ".git", report);
}

export async function shareProjectTree(root: string, group: string): Promise<ShareReport> {
  const report: ShareReport = { shared: 0, failed: 0 };
  const gid = groupIdOf(group);
  if (gid === null) return { shared: 0, failed: 1 };
  await shareEntry(root, gid, false, report);
  return report;
}
