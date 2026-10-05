import {
  MemorySettingsSchema,
  type MemoryExperiment,
  type MemoryFactDto,
  type MemorySettings,
  type ProjectMemoryDto,
  type RunItem,
  type UpdateMemoryFactRequestSchema,
} from "@onyx/contracts";
import type { Prisma, PrismaClient, ProjectFact } from "@onyx/db";
import type { Logger } from "pino";
import type { z } from "zod";
import {
  compareMemoryArms,
  composeMemory,
  extractFacts,
  factLine,
  isExpired,
  statusFor,
  testFact,
  type ComposedMemory,
  type FactCandidate,
  type MemorySample,
} from "../domain/memory";
import { notFound } from "../errors";
import { experimentRuns } from "../infrastructure/run-totals";

type UpdateInput = z.output<typeof UpdateMemoryFactRequestSchema>;

export const MEMORY_SETTINGS_KEY = "memory.settings";
export const DEFAULT_MEMORY_SETTINGS: MemorySettings = {
  enabled: true,
  budgetTokens: 800,
  expiryDays: 30,
  experiment: false,
};
const DAY_MS = 86_400_000;
const EXPERIMENT_DAYS = 90;
const MEASURED_STATUSES = ["COMPLETED", "FAILED", "TIMEOUT"];

export interface StoredMemory {
  text: string;
  tokens: number;
  factIds: string[];
}

export interface MemoryServiceDeps {
  prisma: PrismaClient;
  logger: Logger;
  count: (text: string) => number;
  now?: () => Date;
}

function isItem(value: unknown): value is RunItem {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { kind?: unknown }).kind === "string"
  );
}

export function storedMemory(value: Prisma.JsonValue | null | undefined): StoredMemory | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record["text"] !== "string" || typeof record["tokens"] !== "number") return null;
  const ids = Array.isArray(record["factIds"])
    ? record["factIds"].filter((id): id is string => typeof id === "string")
    : [];
  return { text: record["text"], tokens: record["tokens"], factIds: ids };
}

export class MemoryService {
  private cached: MemorySettings | null = null;

  constructor(private readonly deps: MemoryServiceDeps) {}

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  async settings(): Promise<MemorySettings> {
    if (this.cached) return this.cached;
    const row = await this.deps.prisma.appSetting.findUnique({
      where: { key: MEMORY_SETTINGS_KEY },
    });
    const parsed = MemorySettingsSchema.safeParse(row?.value);
    this.cached = parsed.success ? parsed.data : DEFAULT_MEMORY_SETTINGS;
    return this.cached;
  }

  async updateSettings(settings: MemorySettings): Promise<MemorySettings> {
    const value = MemorySettingsSchema.parse(settings);
    await this.deps.prisma.appSetting.upsert({
      where: { key: MEMORY_SETTINGS_KEY },
      create: { key: MEMORY_SETTINGS_KEY, value },
      update: { value },
    });
    this.cached = value;
    return value;
  }

  async learnFromRun(runId: string): Promise<number> {
    const { prisma } = this.deps;
    const run = await prisma.agentRun.findUnique({
      where: { id: runId },
      select: {
        status: true,
        task: {
          select: {
            projectId: true,
            worktreePath: true,
            project: { select: { rootPath: true } },
          },
        },
      },
    });
    if (!run || run.status === "ABORTED") return 0;
    const events = await prisma.agentEvent.findMany({
      where: { runId },
      select: { items: true },
      orderBy: { seq: "asc" },
    });
    const items = events.flatMap((event): RunItem[] =>
      Array.isArray(event.items) ? (event.items as unknown[]).filter(isItem) : [],
    );
    const root = run.task.worktreePath ?? run.task.project.rootPath;
    const candidates = extractFacts(items, root);
    await this.remember(run.task.projectId, candidates, runId);
    return candidates.length;
  }

  async learnFromLoop(loop: { projectId: string; fullCommand: string; runId: string | null }) {
    const candidate = testFact(loop.fullCommand);
    if (candidate) await this.remember(loop.projectId, [candidate], loop.runId);
  }

  async compose(projectId: string): Promise<ComposedMemory | null> {
    const settings = await this.settings();
    if (!settings.enabled) return null;
    const facts = await this.deps.prisma.projectFact.findMany({
      where: { projectId, status: "ACTIVE" },
    });
    return composeMemory(facts, {
      budgetTokens: settings.budgetTokens,
      expiryDays: settings.expiryDays,
      now: this.now(),
      count: this.deps.count,
    });
  }

  async project(projectId: string): Promise<ProjectMemoryDto> {
    const { prisma } = this.deps;
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true },
    });
    if (!project) throw notFound("Project");
    await this.prune(projectId);
    const [settings, facts, preview] = await Promise.all([
      this.settings(),
      prisma.projectFact.findMany({
        where: { projectId, status: { not: "CANDIDATE" } },
        orderBy: [{ pinned: "desc" }, { lastSeenAt: "desc" }],
      }),
      this.compose(projectId),
    ]);
    const runIds = [
      ...new Set(facts.flatMap((fact) => (fact.sourceRunId ? [fact.sourceRunId] : []))),
    ];
    const runs =
      runIds.length === 0
        ? []
        : await prisma.agentRun.findMany({
            where: { id: { in: runIds } },
            select: { id: true, task: { select: { title: true } } },
          });
    const titles = new Map(runs.map((run) => [run.id, run.task.title]));
    const included = new Set(preview?.factIds ?? []);
    return {
      projectId,
      settings,
      preview: preview
        ? {
            text: preview.text,
            tokens: preview.tokens,
            included: preview.factIds.length,
            omitted: preview.omitted,
          }
        : null,
      facts: facts.map((fact) => this.toDto(fact, settings, titles, included)),
    };
  }

  async update(projectId: string, factId: string, input: UpdateInput): Promise<ProjectMemoryDto> {
    const fact = await this.deps.prisma.projectFact.findFirst({ where: { id: factId, projectId } });
    if (!fact) throw notFound("Fact");
    await this.deps.prisma.projectFact.update({
      where: { id: factId },
      data: {
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.pinned !== undefined ? { pinned: input.pinned } : {}),
        ...(input.text !== undefined ? { text: input.text } : {}),
        ...(input.status !== undefined ? { lastSeenAt: this.now() } : {}),
      },
    });
    return this.project(projectId);
  }

  async addNote(projectId: string, text: string): Promise<ProjectMemoryDto> {
    const now = this.now();
    await this.deps.prisma.projectFact.upsert({
      where: { projectId_kind_key: { projectId, kind: "NOTE", key: text.toLowerCase() } },
      create: {
        projectId,
        kind: "NOTE",
        key: text.toLowerCase(),
        subject: text,
        status: "ACTIVE",
        pinned: true,
        firstSeenAt: now,
        lastSeenAt: now,
      },
      update: { status: "ACTIVE", lastSeenAt: now },
    });
    return this.project(projectId);
  }

  async remove(projectId: string, factId: string): Promise<ProjectMemoryDto> {
    const deleted = await this.deps.prisma.projectFact.deleteMany({
      where: { id: factId, projectId, kind: "NOTE" },
    });
    if (deleted.count === 0)
      await this.deps.prisma.projectFact.updateMany({
        where: { id: factId, projectId },
        data: { status: "DISMISSED", pinned: false, lastSeenAt: this.now() },
      });
    return this.project(projectId);
  }

  async experiment(): Promise<MemoryExperiment> {
    const settings = await this.settings();
    const runs = await experimentRuns(
      this.deps.prisma,
      new Date(this.now().getTime() - EXPERIMENT_DAYS * DAY_MS),
      MEASURED_STATUSES,
      "memoryArm",
    );
    const withMemory: MemorySample[] = [];
    const without: MemorySample[] = [];
    for (const run of runs) {
      if (run.inputTokens === null) continue;
      const sample: MemorySample = {
        completed: run.status === "COMPLETED",
        contextTokens:
          run.inputTokens + (run.cacheCreationTokens ?? 0) + (run.cacheReadTokens ?? 0),
        readFiles: run.ctxReadFiles ?? 0,
        turns: run.numTurns,
      };
      (run.memoryArm === "NO_MEMORY" ? without : withMemory).push(sample);
    }
    return compareMemoryArms({
      enabled: settings.enabled && settings.experiment,
      withMemory,
      without,
      windowDays: EXPERIMENT_DAYS,
    });
  }

  async prune(projectId: string): Promise<void> {
    const settings = await this.settings();
    const now = this.now().getTime();
    await this.deps.prisma.projectFact.deleteMany({
      where: {
        projectId,
        pinned: false,
        kind: { not: "NOTE" },
        OR: [
          {
            status: { not: "DISMISSED" },
            lastSeenAt: { lt: new Date(now - settings.expiryDays * DAY_MS) },
          },
          {
            status: "DISMISSED",
            lastSeenAt: { lt: new Date(now - settings.expiryDays * 3 * DAY_MS) },
          },
        ],
      },
    });
  }

  private async remember(
    projectId: string,
    candidates: readonly FactCandidate[],
    runId: string | null,
  ): Promise<void> {
    if (candidates.length === 0) return;
    const { prisma } = this.deps;
    const now = this.now();
    const existing = await prisma.projectFact.findMany({
      where: { projectId, OR: candidates.map((fact) => ({ kind: fact.kind, key: fact.key })) },
    });
    const known = new Map(existing.map((fact) => [`${fact.kind}:${fact.key}`, fact]));
    await prisma.$transaction(
      candidates.flatMap((candidate) => {
        const fact = known.get(`${candidate.kind}:${candidate.key}`);
        if (!fact)
          return [
            prisma.projectFact.create({
              data: {
                projectId,
                kind: candidate.kind,
                key: candidate.key,
                subject: candidate.subject,
                detail: candidate.detail,
                sourcePath: candidate.path,
                sourceRunId: runId,
                status: statusFor(candidate.kind, 1),
                firstSeenAt: now,
                lastSeenAt: now,
              },
            }),
          ];
        if (fact.status === "DISMISSED")
          return [prisma.projectFact.update({ where: { id: fact.id }, data: { lastSeenAt: now } })];
        const counted = runId !== null && fact.sourceRunId === runId;
        const evidence = counted ? fact.evidence : fact.evidence + 1;
        const promoted = statusFor(candidate.kind, evidence);
        return [
          prisma.projectFact.update({
            where: { id: fact.id },
            data: {
              evidence,
              lastSeenAt: now,
              detail: candidate.detail ?? fact.detail,
              ...(runId ? { sourceRunId: runId } : {}),
              ...(fact.status === "CANDIDATE" ? { status: promoted } : {}),
            },
          }),
        ];
      }),
    );
  }

  private toDto(
    fact: ProjectFact,
    settings: MemorySettings,
    titles: Map<string, string>,
    included: Set<string>,
  ): MemoryFactDto {
    const expires =
      fact.pinned || fact.kind === "NOTE"
        ? null
        : new Date(fact.lastSeenAt.getTime() + settings.expiryDays * DAY_MS).toISOString();
    return {
      id: fact.id,
      kind: fact.kind,
      status: fact.status,
      subject: fact.subject,
      detail: fact.detail,
      text: fact.text,
      line: factLine(fact),
      evidence: fact.evidence,
      pinned: fact.pinned,
      sourceRunId: fact.sourceRunId,
      sourceTaskTitle: fact.sourceRunId ? (titles.get(fact.sourceRunId) ?? null) : null,
      sourcePath: fact.sourcePath,
      firstSeenAt: fact.firstSeenAt.toISOString(),
      lastSeenAt: fact.lastSeenAt.toISOString(),
      expiresAt: isExpired(fact, settings.expiryDays, this.now()) ? null : expires,
      included: included.has(fact.id),
    };
  }
}
