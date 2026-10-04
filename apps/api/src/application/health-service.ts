import { constants } from "node:fs";
import { access, readFile, statfs, stat } from "node:fs/promises";
import { delimiter, isAbsolute, join, resolve } from "node:path";
import type { GitSummary, IndexState, ProjectHealthReport } from "@onyx/contracts";
import type { PrismaClient } from "@onyx/db";
import {
  credentialsCheck,
  diskCheck,
  gitCheck,
  indexCheck,
  renderFinding,
  resolveTestCommand,
  testsCheck,
  worstLevel,
  type DiskFacts,
  type HealthFinding,
  type TestRunnerFacts,
} from "../domain/health";
import { detectStack } from "../domain/stack-commands";
import { detectRunner } from "../domain/tdd/runners";
import { notFound } from "../errors";
import { githubRepoOf } from "./git-service";
import { toStringArray } from "./mappers";
import { readStackFacts } from "./project-setup";

export const HEALTH_TTL_MS = 30_000;
const LOCAL_BINARY_DIRS = [join("node_modules", ".bin"), join(".venv", "bin"), join("venv", "bin")];

export interface HealthProject {
  id: string;
  rootPath: string;
  gitRemote: string | null;
  indexedAt: Date | null;
  indexError: string | null;
  allowedTools: unknown;
}

export interface FolderSpace {
  bavail: number | bigint;
  blocks: number | bigint;
  bsize: number | bigint;
}

export interface HealthServiceDeps {
  prisma: PrismaClient;
  isIndexing: (projectId: string) => boolean;
  gitSummary: (projectId: string, rootPath: string, now: Date) => Promise<GitSummary>;
  claudeConnected: () => Promise<boolean>;
  githubToken: () => Promise<boolean>;
  folders: readonly string[];
  statfs?: (path: string) => Promise<FolderSpace>;
  searchPath?: () => string;
  now?: () => Date;
  ttlMs?: number;
}

interface LocalFacts {
  key: string;
  at: number;
  tests: TestRunnerFacts;
  githubRemote: boolean;
}

interface SharedFacts {
  at: number;
  disks: DiskFacts[];
  claude: boolean;
  githubToken: boolean;
}

async function executable(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK);
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

export async function findProgram(
  name: string,
  root: string,
  searchPath: string,
): Promise<boolean> {
  if (name.includes("/")) return executable(isAbsolute(name) ? name : resolve(root, name));
  const directories = [
    ...LOCAL_BINARY_DIRS.map((directory) => join(root, directory)),
    ...searchPath.split(delimiter).filter((entry) => entry.length > 0),
  ];
  for (const directory of directories) if (await executable(join(directory, name))) return true;
  return false;
}

export async function inspectTestRunner(
  root: string,
  allowedRules: readonly string[],
  searchPath: string,
): Promise<TestRunnerFacts> {
  const facts = await readStackFacts(root);
  const resolved = resolveTestCommand({
    allowedRules,
    stackCommands: detectStack(facts).commands.map((entry) => entry.command),
    runner: detectRunner({ packageJson: facts.packageJson, files: facts.files }),
    packageJson: facts.packageJson,
  });
  if (!resolved) return { command: null, missing: [] };
  const missing: string[] = [];
  for (const program of resolved.programs)
    if (!(await findProgram(program, root, searchPath))) missing.push(program);
  return { command: resolved.command, missing };
}

export async function remoteUrls(root: string): Promise<string[]> {
  const text = await readFile(join(root, ".git", "config"), "utf8").catch(() => "");
  return [...text.matchAll(/^\s*url\s*=\s*(.+?)\s*$/gm)].map((match) => match[1] ?? "");
}

export async function folderSpace(
  path: string,
  read: (path: string) => Promise<FolderSpace>,
): Promise<DiskFacts> {
  try {
    const space = await read(path);
    const size = Number(space.bsize);
    return {
      path,
      freeBytes: Number(space.bavail) * size,
      totalBytes: Number(space.blocks) * size,
      error: null,
    };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return {
      path,
      freeBytes: null,
      totalBytes: null,
      error: code ?? (error instanceof Error ? error.message : String(error)),
    };
  }
}

export class HealthService {
  private readonly local = new Map<string, LocalFacts>();
  private shared: SharedFacts | null = null;
  private sharing: Promise<SharedFacts> | null = null;
  private readonly pending = new Map<string, Promise<LocalFacts>>();

  constructor(private readonly deps: HealthServiceDeps) {}

  private get ttl(): number {
    return this.deps.ttlMs ?? HEALTH_TTL_MS;
  }

  forget(projectId?: string): void {
    if (projectId === undefined) {
      this.local.clear();
      this.shared = null;
    } else this.local.delete(projectId);
  }

  async findings(project: HealthProject, git: GitSummary, now: Date): Promise<HealthFinding[]> {
    const [local, shared] = await Promise.all([
      this.localFacts(project, now),
      this.sharedFacts(now),
    ]);
    const state: IndexState = this.deps.isIndexing(project.id)
      ? "indexing"
      : project.indexError !== null
        ? "failed"
        : project.indexedAt
          ? "ready"
          : "never";
    return [
      indexCheck({ state, error: project.indexError, indexedAt: project.indexedAt }, now),
      gitCheck(git),
      testsCheck(local.tests),
      diskCheck(shared.disks),
      credentialsCheck({
        claude: shared.claude,
        githubRemote: local.githubRemote,
        githubToken: shared.githubToken,
      }),
    ];
  }

  async report(projectId: string): Promise<ProjectHealthReport> {
    const now = this.deps.now?.() ?? new Date();
    const project = await this.deps.prisma.project.findUnique({
      where: { id: projectId },
      select: {
        id: true,
        rootPath: true,
        gitRemote: true,
        indexedAt: true,
        indexError: true,
        allowedTools: true,
      },
    });
    if (!project) throw notFound("Project");
    const git = await this.deps.gitSummary(project.id, project.rootPath, now);
    const findings = await this.findings(project, git, now);
    return {
      projectId,
      health: worstLevel(findings.map((finding) => finding.level)),
      checks: findings.map(renderFinding),
      checkedAt: now.toISOString(),
    };
  }

  private localFacts(project: HealthProject, now: Date): Promise<LocalFacts> {
    const allowed = toStringArray(project.allowedTools);
    const key = `${project.rootPath}\n${project.gitRemote ?? ""}\n${allowed.join("\n")}`;
    const cached = this.local.get(project.id);
    if (cached && cached.key === key && now.getTime() - cached.at < this.ttl)
      return Promise.resolve(cached);
    const running = this.pending.get(project.id);
    if (running) return running;
    const started = (async (): Promise<LocalFacts> => {
      const searchPath = this.deps.searchPath?.() ?? process.env["PATH"] ?? "";
      const [tests, urls] = await Promise.all([
        inspectTestRunner(project.rootPath, allowed, searchPath).catch(() => ({
          command: null,
          missing: [],
        })),
        remoteUrls(project.rootPath),
      ]);
      const facts: LocalFacts = {
        key,
        at: now.getTime(),
        tests,
        githubRemote: [project.gitRemote, ...urls].some(
          (url) => githubRepoOf(url ?? null) !== null,
        ),
      };
      this.local.set(project.id, facts);
      return facts;
    })().finally(() => this.pending.delete(project.id));
    this.pending.set(project.id, started);
    return started;
  }

  private sharedFacts(now: Date): Promise<SharedFacts> {
    if (this.shared && now.getTime() - this.shared.at < this.ttl)
      return Promise.resolve(this.shared);
    if (this.sharing) return this.sharing;
    const read = this.deps.statfs ?? ((path: string) => statfs(path));
    this.sharing = (async (): Promise<SharedFacts> => {
      const folders = [...new Set(this.deps.folders)];
      const [disks, claude, githubToken] = await Promise.all([
        Promise.all(folders.map((folder) => folderSpace(folder, read))),
        this.deps.claudeConnected().catch(() => false),
        this.deps.githubToken().catch(() => false),
      ]);
      const facts = { at: now.getTime(), disks, claude, githubToken };
      this.shared = facts;
      return facts;
    })().finally(() => {
      this.sharing = null;
    });
    return this.sharing;
  }
}
