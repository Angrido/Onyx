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
  MORE_ITEMS,
  citedSources,
  classifyQuestion,
  insightPrompt,
  listAnswer,
  translateAnswer,
  type ClassifiedQuestion,
  type IndexAnswer,
} from "../domain/insights";
import { AppError, notFound } from "../errors";
import { interpolate, msg } from "../i18n";
import { READ_ONLY_TOOLS, WRITE_TOOLS, type AgentRunner } from "./agent-runner";
import type { IndexService } from "./index-service";
import type { ProjectContext } from "./project-context";
import type { RouterService } from "./router-service";

type AskInput = z.output<typeof AskInsightRequestSchema>;

const LIST_LIMIT = 50;
const MENTION_LIMIT = 40;
const TEXT = {
  noCycles: msg("No import cycles in the project index."),
  graph: msg("From the import graph of the indexed files."),
  cycle: msg("{count} import cycle:"),
  cycles: msg("{count} import cycles:"),
  largest: msg("The largest files by tokens:"),
  tokens: msg("~{tokens} tokens"),
  tokenCaveat: msg("Token counts from the index; binary and sensitive files are left out."),
  central: msg("The most central files (imported directly or indirectly by many others):"),
  importedByOne: msg("imported by {count} file"),
  importedByMany: msg("imported by {count} files"),
  centralCaveat: msg("Ranked by the centrality of the import graph."),
  definedIn: msg("`{subject}` is defined in:"),
  exported: msg("{kind}, exported: `{signature}`"),
  symbolCaveat: msg("From the symbols of the index."),
  isFile: msg("`{subject}` is a file of the project:"),
  indexCaveat: msg("From the index."),
  importerOne: msg("`{file}` is imported by {count} file:"),
  importerMany: msg("`{file}` is imported by {count} files:"),
  noImporters: msg("No indexed file imports `{file}`."),
  graphCaveat: msg(
    "From the import graph and a text search in the importing files: dynamic imports, re-exports through strings and generated code can be missing. Ask the model when it matters.",
  ),
  importsOneOne: msg("`{file}` imports {count} project file and {packages} package ({names}):"),
  importsOneMany: msg("`{file}` imports {count} project file and {packages} packages ({names}):"),
  importsManyOne: msg("`{file}` imports {count} project files and {packages} package ({names}):"),
  importsManyMany: msg("`{file}` imports {count} project files and {packages} packages ({names}):"),
  importsOne: msg("`{file}` imports {count} project file:"),
  importsMany: msg("`{file}` imports {count} project files:"),
  usedOne: msg("`{subject}` is defined in {where} and used in {count} place:"),
  usedMany: msg("`{subject}` is defined in {where} and used in {count} places:"),
  unused: msg("`{subject}` is defined in {where}; no file that imports it mentions it."),
} as const;
const ANSWER_KEYS: readonly string[] = [...Object.values(TEXT), MORE_ITEMS];

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
    answer: row.mode === "INDEX" ? translateAnswer(row.answer, ANSWER_KEYS) : row.answer,
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
    if (cycles.length === 0) return { answer: `${TEXT.noCycles}\n\n_${TEXT.graph}_`, sources: [] };
    return listAnswer(
      interpolate(cycles.length === 1 ? TEXT.cycle : TEXT.cycles, { count: cycles.length }),
      cycles.map((cycle) => ({
        path: cycle[0] ?? "",
        line: null,
        note: [...cycle, cycle[0]].join(" → "),
      })),
      TEXT.graph,
    );
  }
  if (intent === "LARGEST")
    return listAnswer(
      TEXT.largest,
      context.largestFiles(10).map((file) => ({
        path: file.relPath,
        line: null,
        note: interpolate(TEXT.tokens, { tokens: file.rawTokens.toLocaleString("en-US") }),
      })),
      TEXT.tokenCaveat,
    );
  if (intent === "CENTRAL")
    return listAnswer(
      TEXT.central,
      context.topFiles(10).map((file) => ({
        path: file.relPath,
        line: null,
        note: interpolate(file.inDegree === 1 ? TEXT.importedByOne : TEXT.importedByMany, {
          count: file.inDegree,
        }),
      })),
      TEXT.centralCaveat,
    );
  if (!subject) return null;
  const definitions = looksLikeFile(subject) ? [] : context.definitions(subject);
  const file =
    context.findFile(subject) ??
    (definitions.length > 0 ? (definitions[0]?.relPath ?? null) : null);
  if (intent === "DEFINITION") {
    if (definitions.length > 0)
      return listAnswer(
        interpolate(TEXT.definedIn, { subject }),
        definitions.map((hit) => ({
          path: hit.relPath,
          line: hit.line,
          note: hit.exported
            ? interpolate(TEXT.exported, { kind: hit.kind, signature: hit.signature })
            : `${hit.kind}: \`${hit.signature}\``,
        })),
        TEXT.symbolCaveat,
      );
    return file
      ? listAnswer(
          interpolate(TEXT.isFile, { subject }),
          [{ path: file, line: null }],
          TEXT.indexCaveat,
        )
      : null;
  }
  if (intent === "IMPORTERS" || (intent === "USAGES" && definitions.length === 0)) {
    if (!file) return null;
    const importers = context.importers(file);
    return listAnswer(
      importers.length > 0
        ? interpolate(importers.length === 1 ? TEXT.importerOne : TEXT.importerMany, {
            file,
            count: importers.length,
          })
        : interpolate(TEXT.noImporters, { file }),
      importers.map((path) => ({ path, line: null })),
      TEXT.graphCaveat,
    );
  }
  if (intent === "IMPORTS") {
    if (!file) return null;
    const { internal, external } = context.imports(file);
    const one = internal.length === 1;
    const heading =
      external.length === 0
        ? one
          ? TEXT.importsOne
          : TEXT.importsMany
        : external.length === 1
          ? one
            ? TEXT.importsOneOne
            : TEXT.importsManyOne
          : one
            ? TEXT.importsOneMany
            : TEXT.importsManyMany;
    return listAnswer(
      interpolate(heading, {
        file,
        count: internal.length,
        packages: external.length,
        names: external.join(", "),
      }),
      internal.map((path) => ({ path, line: null })),
      TEXT.graph,
    );
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
        ? interpolate(mentions.length === 1 ? TEXT.usedOne : TEXT.usedMany, {
            subject,
            where,
            count: mentions.length,
          })
        : interpolate(TEXT.unused, { subject, where }),
      mentions.map((hit) => ({ path: hit.relPath, line: hit.line, note: `\`${hit.text}\`` })),
      TEXT.graphCaveat,
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
