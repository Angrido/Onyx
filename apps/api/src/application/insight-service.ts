import {
  ErrorCode,
  type AskInsightRequestSchema,
  type InsightDto,
  type InsightIntent,
  type InsightListResponse,
  type InsightSource,
} from "@onyx/contracts";
import type { Insight, Prisma, PrismaClient } from "@onyx/db";
import type { Logger } from "pino";
import type { z } from "zod";
import {
  INSIGHT_MAX_TURNS,
  citedSources,
  classifyQuestion,
  insightPrompt,
  listAnswer,
  type ClassifiedQuestion,
  type IndexAnswer,
} from "../domain/insights";
import { AppError, notFound } from "../errors";
import { READ_ONLY_TOOLS, WRITE_TOOLS, type AgentRunner } from "./agent-runner";
import type { IndexService } from "./index-service";
import type { ProjectContext } from "./project-context";
import type { RouterService } from "./router-service";

type AskInput = z.output<typeof AskInsightRequestSchema>;

const LIST_LIMIT = 50;
const MENTION_LIMIT = 40;
const GRAPH_CAVEAT =
  "From the import graph and a text search in the importing files: dynamic imports, re-exports through strings and generated code can be missing. Ask the model when it matters.";

export interface InsightServiceDeps {
  prisma: PrismaClient;
  logger: Logger;
  indexes: Pick<IndexService, "context">;
  router: Pick<RouterService, "profileForTier" | "referenceProfile">;
  runner: AgentRunner;
}

function readSources(value: Prisma.JsonValue): InsightSource[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return [];
    const record = entry as Record<string, unknown>;
    if (typeof record["path"] !== "string") return [];
    return [
      { path: record["path"], line: typeof record["line"] === "number" ? record["line"] : null },
    ];
  });
}

export function toInsightDto(row: Insight): InsightDto {
  return {
    id: row.id,
    question: row.question,
    intent: row.intent as InsightIntent,
    mode: row.mode,
    answer: row.answer,
    sources: readSources(row.sources),
    modelId: row.modelId,
    costUsd: row.costUsd,
    tokens: row.tokens,
    createdAt: row.createdAt.toISOString(),
  };
}

function looksLikeFile(subject: string): boolean {
  return subject.includes("/") || /\.[a-z]{1,5}$/i.test(subject);
}

export function answerFromIndex(
  context: ProjectContext,
  question: ClassifiedQuestion,
): IndexAnswer | null {
  const { intent, subject } = question;
  if (intent === "CYCLES") {
    const cycles = context.cycles();
    if (cycles.length === 0)
      return {
        answer:
          "No import cycles in the project index.\n\n_From the import graph of the indexed files._",
        sources: [],
      };
    return listAnswer(
      `${cycles.length} import ${cycles.length === 1 ? "cycle" : "cycles"}:`,
      cycles.map((cycle) => ({
        path: cycle[0] ?? "",
        line: null,
        note: [...cycle, cycle[0]].join(" → "),
      })),
      "From the import graph of the indexed files.",
    );
  }
  if (intent === "LARGEST")
    return listAnswer(
      "The largest files by tokens:",
      context.largestFiles(10).map((file) => ({
        path: file.relPath,
        line: null,
        note: `~${file.rawTokens.toLocaleString("en-US")} tokens`,
      })),
      "Token counts from the index; binary and sensitive files are left out.",
    );
  if (intent === "CENTRAL")
    return listAnswer(
      "The most central files (imported directly or indirectly by many others):",
      context.topFiles(10).map((file) => ({
        path: file.relPath,
        line: null,
        note: `imported by ${file.inDegree} ${file.inDegree === 1 ? "file" : "files"}`,
      })),
      "Ranked by the centrality of the import graph.",
    );
  if (!subject) return null;
  const definitions = looksLikeFile(subject) ? [] : context.definitions(subject);
  const file =
    context.findFile(subject) ??
    (definitions.length > 0 ? (definitions[0]?.relPath ?? null) : null);
  if (intent === "DEFINITION") {
    if (definitions.length > 0)
      return listAnswer(
        `\`${subject}\` is defined in:`,
        definitions.map((hit) => ({
          path: hit.relPath,
          line: hit.line,
          note: `${hit.kind}${hit.exported ? ", exported" : ""}: \`${hit.signature}\``,
        })),
        "From the symbols of the index.",
      );
    return file
      ? listAnswer(
          `\`${subject}\` is a file of the project:`,
          [{ path: file, line: null }],
          "From the index.",
        )
      : null;
  }
  if (intent === "IMPORTERS" || (intent === "USAGES" && definitions.length === 0)) {
    if (!file) return null;
    const importers = context.importers(file);
    return listAnswer(
      importers.length > 0
        ? `\`${file}\` is imported by ${importers.length} ${importers.length === 1 ? "file" : "files"}:`
        : `No indexed file imports \`${file}\`.`,
      importers.map((path) => ({ path, line: null })),
      GRAPH_CAVEAT,
    );
  }
  if (intent === "IMPORTS") {
    if (!file) return null;
    const { internal, external } = context.imports(file);
    const answer = listAnswer(
      `\`${file}\` imports ${internal.length} project ${internal.length === 1 ? "file" : "files"}${external.length > 0 ? ` and ${external.length} ${external.length === 1 ? "package" : "packages"} (${external.join(", ")})` : ""}:`,
      internal.map((path) => ({ path, line: null })),
      "From the import graph of the indexed files.",
    );
    return answer;
  }
  if (intent === "USAGES") {
    const owners = [...new Set(definitions.map((hit) => hit.relPath))];
    const importers = [...new Set(owners.flatMap((owner) => context.importers(owner)))];
    const defined = new Set(definitions.map((hit) => `${hit.relPath}:${hit.line}`));
    const mentions = context
      .mentions(subject, [...importers, ...owners], MENTION_LIMIT)
      .filter((hit) => !defined.has(`${hit.relPath}:${hit.line}`));
    const where = definitions
      .slice(0, 3)
      .map((hit) => `\`${hit.relPath}:${hit.line}\``)
      .join(", ");
    return listAnswer(
      mentions.length > 0
        ? `\`${subject}\` is defined in ${where} and used in ${mentions.length} ${mentions.length === 1 ? "place" : "places"}:`
        : `\`${subject}\` is defined in ${where}; no file that imports it mentions it.`,
      mentions.map((hit) => ({ path: hit.relPath, line: hit.line, note: `\`${hit.text}\`` })),
      GRAPH_CAVEAT,
    );
  }
  return null;
}

export class InsightService {
  constructor(private readonly deps: InsightServiceDeps) {}

  async list(projectId: string): Promise<InsightListResponse> {
    const { prisma } = this.deps;
    const [rows, counts, context] = await Promise.all([
      prisma.insight.findMany({
        where: { projectId },
        orderBy: { createdAt: "desc" },
        take: LIST_LIMIT,
      }),
      prisma.insight.groupBy({ by: ["mode"], where: { projectId }, _count: { _all: true } }),
      this.deps.indexes.context(projectId),
    ]);
    const count = (mode: "INDEX" | "MODEL") =>
      counts.find((entry) => entry.mode === mode)?._count._all ?? 0;
    return {
      items: rows.map(toInsightDto),
      indexAnswers: count("INDEX"),
      modelAnswers: count("MODEL"),
      indexed: context !== null,
    };
  }

  async ask(projectId: string, input: AskInput): Promise<InsightDto> {
    const { prisma } = this.deps;
    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw notFound("Project");
    const context = await this.deps.indexes.context(projectId);
    const classified = classifyQuestion(input.question);
    const fromIndex = context ? answerFromIndex(context, classified) : null;
    if (fromIndex && !input.useModel) {
      const row = await prisma.insight.create({
        data: {
          projectId,
          question: input.question,
          intent: classified.intent,
          mode: "INDEX",
          answer: fromIndex.answer,
          sources: fromIndex.sources as unknown as Prisma.InputJsonValue,
        },
      });
      return toInsightDto(row);
    }
    const profile = await this.deps.router.profileForTier("SCOUT");
    const modelId = profile?.id ?? (await this.deps.router.referenceProfile())?.id ?? "";
    const run = await this.deps.runner.run({
      runId: `insight-${projectId}-${Date.now().toString(36)}`,
      owner: `insight:${projectId}`,
      projectId,
      cwd: project.rootPath,
      prompt: insightPrompt({
        projectName: project.name,
        question: input.question,
        hint: fromIndex?.answer ?? null,
      }),
      modelId,
      maxTurns: INSIGHT_MAX_TURNS,
      permissionMode: "plan",
      allowedTools: READ_ONLY_TOOLS,
      disallowedTools: WRITE_TOOLS,
      jsonSchema: null,
      purpose: "insights",
      mcp: true,
    });
    const text = run.result?.resultText?.trim() ?? "";
    if (run.exit.reason !== "completed" || !run.result || run.result.isError || text.length === 0)
      throw new AppError(
        502,
        ErrorCode.Unavailable,
        `Claude could not answer (${run.result?.isError ? "error" : run.exit.reason})`,
      );
    const row = await prisma.insight.create({
      data: {
        projectId,
        question: input.question,
        intent: classified.intent,
        mode: "MODEL",
        answer: text,
        sources: citedSources(text) as unknown as Prisma.InputJsonValue,
        modelId: run.modelId,
        costUsd: run.costUsd,
        tokens: run.tokens,
      },
    });
    return toInsightDto(row);
  }
}
