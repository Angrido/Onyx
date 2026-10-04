import {
  SEARCH_MARK_END,
  SEARCH_MARK_START,
  type SearchKind,
  type SearchResponse,
  type SearchResult,
} from "@onyx/contracts";
import { Prisma, type PrismaClient } from "@onyx/db";
import { ftsQuery } from "../infrastructure/search-index";

interface Hit {
  kind: SearchKind;
  refId: string;
  projectId: string;
  title: string;
  snippet: string;
}

export class SearchService {
  constructor(private readonly prisma: PrismaClient) {}

  async search(
    text: string,
    options: { projectId?: string; limit: number },
  ): Promise<SearchResponse> {
    const match = ftsQuery(text);
    if (!match) return { query: text, items: [] };
    const scope = options.projectId
      ? Prisma.sql`AND "projectId" = ${options.projectId}`
      : Prisma.empty;
    const hits = await this.prisma.$queryRaw<Hit[]>(Prisma.sql`
      SELECT "kind" AS kind, "refId" AS refId, "projectId" AS projectId, "title" AS title,
        snippet("SearchEntry", 4, ${SEARCH_MARK_START}, ${SEARCH_MARK_END}, '…', 12) AS snippet
      FROM "SearchEntry"
      WHERE "SearchEntry" MATCH ${match} ${scope}
      ORDER BY bm25("SearchEntry", 0.0, 0.0, 0.0, 6.0, 1.0)
      LIMIT ${options.limit * 2}`);
    const ids = (kind: SearchKind) =>
      hits.filter((hit) => hit.kind === kind).map((hit) => hit.refId);
    const [projects, tasks, runs, files] = await Promise.all([
      this.prisma.project.findMany({
        where: { id: { in: [...new Set(hits.map((hit) => hit.projectId))] } },
        select: { id: true, name: true },
      }),
      this.prisma.task.findMany({
        where: { id: { in: ids("TASK") } },
        select: { id: true, status: true },
      }),
      this.prisma.agentRun.findMany({
        where: { id: { in: ids("RUN") } },
        select: { id: true, status: true },
      }),
      this.prisma.fileNode.findMany({
        where: { id: { in: ids("FILE") } },
        select: { id: true, relPath: true },
      }),
    ]);
    const names = new Map(projects.map((project) => [project.id, project.name]));
    const taskStatus = new Map(tasks.map((task) => [task.id, task.status]));
    const runStatus = new Map(runs.map((run) => [run.id, run.status]));
    const paths = new Map(files.map((file) => [file.id, file.relPath]));
    const items: SearchResult[] = [];
    for (const hit of hits) {
      const projectName = names.get(hit.projectId);
      if (projectName === undefined) continue;
      const base = {
        kind: hit.kind,
        id: hit.refId,
        projectId: hit.projectId,
        projectName,
        title: hit.title,
        snippet: hit.kind === "FILE" ? "" : hit.snippet,
      };
      if (hit.kind === "TASK" && taskStatus.has(hit.refId))
        items.push({
          ...base,
          status: taskStatus.get(hit.refId) ?? null,
          href: `/tasks/${hit.refId}`,
        });
      else if (hit.kind === "RUN" && runStatus.has(hit.refId))
        items.push({
          ...base,
          status: runStatus.get(hit.refId) ?? null,
          href: `/runs/${hit.refId}`,
        });
      else if (hit.kind === "FILE" && paths.has(hit.refId))
        items.push({
          ...base,
          status: null,
          href: `/projects/${hit.projectId}/graph?focus=${encodeURIComponent(paths.get(hit.refId) ?? "")}`,
        });
      if (items.length >= options.limit) break;
    }
    return { query: text, items };
  }
}
