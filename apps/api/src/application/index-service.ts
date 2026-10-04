import type { IndexProgress, IndexStatusDto } from "@onyx/contracts";
import type { PrismaClient } from "@onyx/db";
import {
  indexProject,
  type DomainName,
  type PreviousFile,
  type WorkspaceRule,
} from "@onyx/graphify";
import type { LeanAnalyzer } from "@onyx/lean-ctx";
import type { Logger } from "pino";
import { notFound } from "../errors";
import type { IndexStore, StoredIndex } from "../infrastructure/index-store";
import type { WsHub } from "../infrastructure/ws-hub";
import { toStringArray } from "./mappers";
import { ProjectContext } from "./project-context";

const DEFAULT_MAX_CONTEXTS = 8;

export interface IndexServiceDeps {
  prisma: PrismaClient;
  store: IndexStore;
  hub: WsHub;
  logger: Logger;
  analyzer: LeanAnalyzer;
  versionSuffix?: () => string | undefined;
  refreshDelayMs?: number;
  maxContexts?: number;
}

interface RunningIndex {
  promise: Promise<void>;
  controller: AbortController;
  progress: IndexProgress | null;
}

const DEFAULT_REFRESH_DELAY_MS = 1_500;
const PROGRESS_INTERVAL_MS = 250;

function previousFiles(index: StoredIndex | null): Map<string, PreviousFile> {
  const previous = new Map<string, PreviousFile>();
  for (const [relPath, file] of index?.files ?? []) {
    previous.set(relPath, {
      contentHash: file.contentHash,
      analyzerVersion: file.analyzerVersion,
      analysis: file.analysis,
    });
  }
  return previous;
}

export class IndexService {
  private readonly running = new Map<string, RunningIndex>();
  private readonly contexts = new Map<string, ProjectContext>();
  private readonly refreshTimers = new Map<string, NodeJS.Timeout>();
  private stopped = false;

  constructor(private readonly deps: IndexServiceDeps) {}

  async status(projectId: string): Promise<IndexStatusDto> {
    const project = await this.deps.prisma.project.findUnique({
      where: { id: projectId },
      select: { indexedAt: true, indexStats: true, indexError: true },
    });
    if (!project) throw notFound("Project");
    const running = this.running.get(projectId);
    return {
      projectId,
      state: running
        ? "indexing"
        : project.indexError !== null
          ? "failed"
          : project.indexedAt
            ? "ready"
            : "never",
      indexedAt: project.indexedAt?.toISOString() ?? null,
      stats: (project.indexStats as IndexStatusDto["stats"]) ?? null,
      error: project.indexError,
      progress: running?.progress ?? null,
    };
  }

  isIndexing(projectId: string): boolean {
    return this.running.has(projectId);
  }

  async start(projectId: string): Promise<IndexStatusDto> {
    if (!this.running.has(projectId) && !this.stopped) {
      const project = await this.deps.prisma.project.findUnique({
        where: { id: projectId },
        select: { id: true },
      });
      if (!project) throw notFound("Project");
      this.launch(projectId);
    }
    return this.status(projectId);
  }

  async waitForIndex(projectId: string, timeoutMs: number): Promise<ProjectContext | null> {
    const existing = await this.context(projectId);
    if (existing) return existing;
    if (!this.running.has(projectId)) await this.start(projectId).catch(() => undefined);
    const running = this.running.get(projectId);
    if (running) {
      let timer: NodeJS.Timeout | undefined;
      await Promise.race([
        running.promise,
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, timeoutMs);
        }),
      ]);
      clearTimeout(timer);
    }
    return this.context(projectId);
  }

  async context(projectId: string): Promise<ProjectContext | null> {
    const cached = this.contexts.get(projectId);
    if (cached) {
      this.contexts.delete(projectId);
      this.contexts.set(projectId, cached);
      return cached;
    }
    const project = await this.deps.prisma.project.findUnique({
      where: { id: projectId },
      select: { rootPath: true },
    });
    if (!project) return null;
    const stored = await this.deps.store.load(projectId);
    if (!stored) return null;
    try {
      const context = new ProjectContext(projectId, project.rootPath, stored, this.deps.analyzer);
      this.contexts.set(projectId, context);
      while (this.contexts.size > (this.deps.maxContexts ?? DEFAULT_MAX_CONTEXTS)) {
        const oldest = this.contexts.keys().next().value;
        if (oldest === undefined) break;
        this.contexts.delete(oldest);
      }
      return context;
    } catch (error) {
      this.deps.logger.warn({ err: error, projectId }, "Project index is not usable");
      return null;
    }
  }

  scheduleRefresh(projectId: string): void {
    if (this.stopped) return;
    clearTimeout(this.refreshTimers.get(projectId));
    const timer = setTimeout(() => {
      this.refreshTimers.delete(projectId);
      if (!this.running.has(projectId)) this.launch(projectId);
    }, this.deps.refreshDelayMs ?? DEFAULT_REFRESH_DELAY_MS);
    timer.unref();
    this.refreshTimers.set(projectId, timer);
  }

  async idle(projectId: string): Promise<void> {
    await this.running.get(projectId)?.promise;
  }

  async shutdown(): Promise<void> {
    this.stopped = true;
    for (const timer of this.refreshTimers.values()) clearTimeout(timer);
    this.refreshTimers.clear();
    for (const running of this.running.values()) running.controller.abort();
    await Promise.allSettled([...this.running.values()].map((running) => running.promise));
  }

  private launch(projectId: string): void {
    const controller = new AbortController();
    const entry: RunningIndex = { promise: Promise.resolve(), controller, progress: null };
    this.running.set(projectId, entry);
    entry.promise = this.execute(projectId, entry).finally(() => {
      this.running.delete(projectId);
    });
  }

  private publish(projectId: string, entry: RunningIndex, progress: IndexProgress): void {
    entry.progress = progress;
    this.deps.hub.publishIndexProgress({
      projectId,
      state: "indexing",
      progress,
      stats: null,
      error: null,
    });
  }

  private async execute(projectId: string, entry: RunningIndex): Promise<void> {
    const { prisma, store, hub, logger, analyzer } = this.deps;
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: { workspaces: { orderBy: { position: "asc" } } },
    });
    if (!project) return;

    const domainRules: WorkspaceRule[] = project.workspaces.map((workspace) => ({
      workspaceId: workspace.id,
      domain: workspace.domain as DomainName,
      globs: toStringArray(workspace.pathGlobs),
    }));
    let lastPublished = 0;
    const versionSuffix = this.deps.versionSuffix?.();
    try {
      const previous = previousFiles(await store.load(projectId));
      const index = await indexProject({
        rootDir: project.rootPath,
        analyzer,
        previous,
        domainRules,
        ...(versionSuffix === undefined ? {} : { versionSuffix }),
        signal: entry.controller.signal,
        onProgress: (progress) => {
          const now = Date.now();
          const boundary = progress.done === 0 || progress.done === progress.total;
          if (!boundary && now - lastPublished < PROGRESS_INTERVAL_MS) return;
          lastPublished = now;
          this.publish(projectId, entry, progress);
        },
      });
      this.publish(projectId, entry, { phase: "saving", done: 0, total: index.stats.files });
      await store.save(projectId, index);
      this.contexts.delete(projectId);
      hub.publishIndexProgress({
        projectId,
        state: "ready",
        progress: null,
        stats: index.stats,
        error: null,
      });
      logger.info({ projectId, ...index.stats }, "Project indexed");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (entry.controller.signal.aborted) {
        logger.info({ projectId }, "Indexing aborted");
        return;
      }
      logger.error({ err: error, projectId }, "Indexing failed");
      await store.recordFailure(projectId, message).catch(() => undefined);
      hub.publishIndexProgress({
        projectId,
        state: "failed",
        progress: null,
        stats: null,
        error: message,
      });
    }
  }
}
