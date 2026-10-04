import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import type {
  FindingTaskRequestSchema,
  IdeationDto,
  IdeationFindingDto,
  IdeationRunDto,
  TaskDto,
} from "@onyx/contracts";
import type { IdeationFinding, IdeationRun, PrismaClient } from "@onyx/db";
import type { Logger } from "pino";
import type { z } from "zod";
import {
  CATEGORY_KINDS,
  IDEATION_JSON_SCHEMA,
  MAX_REVIEWED,
  MAX_SCAN_BYTES,
  REVIEW_MAX_TURNS,
  capPerRule,
  findingTaskPrompt,
  fingerprint,
  graphFindings,
  parseNpmAudit,
  readReview,
  reviewPrompt,
  scanSource,
  snippet,
  translateFinding,
  type StaticFinding,
} from "../domain/ideation";
import { translateKnown } from "../domain/insights";
import { badRequest, conflict, notFound } from "../errors";
import { interpolate, msg } from "../i18n";
import { READ_ONLY_TOOLS, WRITE_TOOLS, structuredOf, type AgentRunner } from "./agent-runner";
import type { IndexService } from "./index-service";
import type { ProjectContext } from "./project-context";
import type { RouterService } from "./router-service";
import type { TaskService } from "./task-service";

type TaskInput = z.output<typeof FindingTaskRequestSchema>;

const execFileAsync = promisify(execFile);
const AUDIT_TIMEOUT_MS = 90_000;
const HOTSPOT_TOKENS = 4_000;
const HOTSPOT_IMPORTERS = 5;
const HOTSPOTS = 5;
const SEVERITY_ORDER = { HIGH: 0, MEDIUM: 1, LOW: 2 } as const;
const AUDIT = {
  failed: msg("{tool} audit could not run: {error}"),
  vulnerableOne: msg("{tool} audit: {count} vulnerable package"),
  vulnerableMany: msg("{tool} audit: {count} vulnerable packages"),
  noJson: msg("{tool} audit returned no JSON"),
  notRun: msg("Dependency audit not run"),
  noLockfile: msg("No lockfile: dependency audit skipped"),
} as const;
const AUDIT_KEYS: readonly string[] = Object.values(AUDIT);

export interface IdeationServiceDeps {
  prisma: PrismaClient;
  logger: Logger;
  indexes: Pick<IndexService, "context">;
  router: Pick<RouterService, "profileForTier" | "referenceProfile">;
  runner: AgentRunner;
  tasks: Pick<TaskService, "create">;
  count: (text: string) => number;
  sourceEnv?: NodeJS.ProcessEnv;
  audit?: boolean;
}

function toRunDto(run: IdeationRun): IdeationRunDto {
  return {
    id: run.id,
    status: run.status,
    files: run.files,
    audit: run.audit === null ? null : translateKnown(run.audit, AUDIT_KEYS),
    projectTokens: run.projectTokens,
    snippetTokens: run.snippetTokens,
    modelTokens: run.modelTokens,
    modelCostUsd: run.modelCostUsd,
    reviewedAt: run.reviewedAt?.toISOString() ?? null,
    message: run.message,
    createdAt: run.createdAt.toISOString(),
    endedAt: run.endedAt?.toISOString() ?? null,
  };
}

function toFindingDto(finding: IdeationFinding): IdeationFindingDto {
  return {
    id: finding.id,
    category: finding.category,
    severity: finding.severity,
    rule: finding.rule,
    ...translateFinding(finding),
    file: finding.file,
    line: finding.line,
    confidence: finding.confidence,
    source: finding.source,
    verdict:
      finding.verdict === "REAL" ||
      finding.verdict === "FALSE_POSITIVE" ||
      finding.verdict === "UNSURE"
        ? finding.verdict
        : null,
    fix: finding.fix,
    state: finding.state,
    taskId: finding.taskId,
  };
}

function reviewable(finding: IdeationFinding): boolean {
  return (
    finding.state === "OPEN" &&
    finding.source === "STATIC" &&
    finding.verdict === null &&
    finding.file !== null &&
    finding.line !== null
  );
}

export class IdeationService {
  private readonly running = new Map<string, Promise<void>>();

  constructor(private readonly deps: IdeationServiceDeps) {}

  async latest(projectId: string): Promise<IdeationDto> {
    const run = await this.deps.prisma.ideationRun.findFirst({
      where: { projectId },
      orderBy: { createdAt: "desc" },
      include: { findings: true },
    });
    if (!run) return { run: null, findings: [], reviewable: 0 };
    const findings = [...run.findings].sort(
      (left, right) =>
        Number(left.state !== "OPEN") - Number(right.state !== "OPEN") ||
        SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity] ||
        right.confidence - left.confidence ||
        (left.file ?? "").localeCompare(right.file ?? "") ||
        (left.line ?? 0) - (right.line ?? 0),
    );
    return {
      run: toRunDto(run),
      findings: findings.map(toFindingDto),
      reviewable: Math.min(MAX_REVIEWED, findings.filter(reviewable).length),
    };
  }

  async start(projectId: string): Promise<IdeationDto> {
    const { prisma } = this.deps;
    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw notFound("Project");
    if (this.running.has(projectId)) throw conflict("An analysis is already running");
    const run = await prisma.ideationRun.create({ data: { projectId } });
    const work = this.analyze(run.id, projectId, project.rootPath)
      .catch(async (error: unknown) => {
        this.deps.logger.warn({ err: error, projectId }, "Ideation failed");
        await prisma.ideationRun.update({
          where: { id: run.id },
          data: {
            status: "FAILED",
            endedAt: new Date(),
            message: error instanceof Error ? error.message : String(error),
          },
        });
      })
      .finally(() => this.running.delete(projectId));
    this.running.set(projectId, work);
    return this.latest(projectId);
  }

  async settled(projectId: string): Promise<void> {
    await this.running.get(projectId);
  }

  async idle(): Promise<void> {
    await Promise.allSettled([...this.running.values()]);
  }

  async review(projectId: string): Promise<IdeationDto> {
    const { prisma } = this.deps;
    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw notFound("Project");
    const run = await prisma.ideationRun.findFirst({
      where: { projectId, status: "DONE" },
      orderBy: { createdAt: "desc" },
      include: { findings: true },
    });
    if (!run) throw badRequest("Run the analysis first");
    const context = await this.deps.indexes.context(projectId);
    if (!context) throw badRequest("The project is not indexed yet");
    const candidates = run.findings
      .filter(reviewable)
      .sort(
        (left, right) =>
          SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity] ||
          right.confidence - left.confidence,
      )
      .slice(0, MAX_REVIEWED);
    if (candidates.length === 0) throw badRequest("No finding left for Claude to check");
    const items = candidates.flatMap((finding, index) => {
      const source = finding.file ? context.readSource(finding.file) : null;
      if (source === null || finding.file === null || finding.line === null) return [];
      return [
        {
          id: String(index + 1),
          finding,
          title: finding.title,
          rule: finding.rule,
          file: finding.file,
          snippet: snippet(source, finding.line),
        },
      ];
    });
    const prompt = reviewPrompt(items);
    const profile = await this.deps.router.profileForTier("SCOUT");
    const modelId = profile?.id ?? (await this.deps.router.referenceProfile())?.id ?? "";
    const result = await this.deps.runner.run({
      runId: `ideation-${run.id}-${Date.now().toString(36)}`,
      owner: `ideation:${projectId}`,
      projectId,
      cwd: project.rootPath,
      prompt,
      modelId,
      maxTurns: REVIEW_MAX_TURNS,
      permissionMode: "plan",
      allowedTools: READ_ONLY_TOOLS,
      disallowedTools: WRITE_TOOLS,
      jsonSchema: JSON.stringify(IDEATION_JSON_SCHEMA),
      purpose: "ideation",
    });
    const reviewed =
      result.result && !result.result.isError
        ? readReview(structuredOf(result.result), new Set(items.map((item) => item.id)))
        : [];
    await prisma.$transaction([
      ...reviewed.flatMap((entry) => {
        const item = items.find((candidate) => candidate.id === entry.id);
        if (!item) return [];
        return [
          prisma.ideationFinding.update({
            where: { id: item.finding.id },
            data: {
              verdict: entry.verdict,
              confidence: entry.confidence,
              ...(entry.explanation ? { explanation: entry.explanation } : {}),
              fix: entry.fix,
            },
          }),
        ];
      }),
      prisma.ideationRun.update({
        where: { id: run.id },
        data: {
          reviewedAt: new Date(),
          snippetTokens: (run.snippetTokens ?? 0) + this.deps.count(prompt),
          modelTokens: (run.modelTokens ?? 0) + (result.tokens ?? 0),
          modelCostUsd: (run.modelCostUsd ?? 0) + (result.costUsd ?? 0),
          message:
            reviewed.length === 0
              ? `Claude did not return a usable answer (${result.result?.isError ? "error" : result.exit.reason})`
              : null,
        },
      }),
    ]);
    return this.latest(projectId);
  }

  async dismiss(findingId: string): Promise<IdeationDto> {
    const finding = await this.deps.prisma.ideationFinding.findUnique({ where: { id: findingId } });
    if (!finding) throw notFound("Finding");
    await this.deps.prisma.ideationFinding.update({
      where: { id: findingId },
      data: { state: "DISMISSED" },
    });
    return this.latest(finding.projectId);
  }

  async task(findingId: string, input: TaskInput): Promise<TaskDto> {
    const { prisma } = this.deps;
    const finding = await prisma.ideationFinding.findUnique({ where: { id: findingId } });
    if (!finding) throw notFound("Finding");
    if (finding.taskId) throw conflict("A task already exists for this finding");
    const task = await this.deps.tasks.create({
      projectId: finding.projectId,
      workspaceId: input.workspaceId ?? null,
      title:
        `${finding.title}${finding.file ? ` in ${finding.file.split("/").pop() ?? finding.file}` : ""}`.slice(
          0,
          200,
        ),
      prompt: findingTaskPrompt(finding),
      kind: CATEGORY_KINDS[finding.category],
      priority: finding.severity === "HIGH" ? 10 : 0,
      targetPaths: finding.file && finding.file !== "package.json" ? [finding.file] : [],
      canWait: finding.severity !== "HIGH",
    });
    await prisma.ideationFinding.update({
      where: { id: findingId },
      data: { state: "TASKED", taskId: task.id },
    });
    return task;
  }

  private async analyze(runId: string, projectId: string, root: string): Promise<void> {
    const { prisma } = this.deps;
    const context = await this.deps.indexes.context(projectId);
    if (!context) throw new Error("The project is not indexed yet");
    const files = context.sourceFiles().filter((file) => file.sizeBytes <= MAX_SCAN_BYTES);
    const found: StaticFinding[] = [];
    for (const file of files) {
      const content = context.readSource(file.relPath);
      if (content === null) continue;
      found.push(...scanSource(file.relPath, file.language, content));
    }
    found.push(...graphFindings({ cycles: context.cycles(), hotspots: this.hotspots(context) }));
    const audit = this.deps.audit === false ? null : await this.audit(root);
    if (audit) found.push(...audit.findings);
    const findings = capPerRule(found);
    const previous = await prisma.ideationFinding.findMany({
      where: { projectId, state: { in: ["DISMISSED", "TASKED"] } },
      select: { fingerprint: true, state: true, taskId: true },
    });
    const decided = new Map(previous.map((entry) => [entry.fingerprint, entry]));
    await prisma.$transaction([
      prisma.ideationFinding.createMany({
        data: findings.map((finding) => {
          const key = fingerprint(finding);
          const earlier = decided.get(key);
          return {
            runId,
            projectId,
            fingerprint: key,
            ...finding,
            state: earlier?.state ?? "OPEN",
            taskId: earlier?.taskId ?? null,
          };
        }),
      }),
      prisma.ideationRun.update({
        where: { id: runId },
        data: {
          status: "DONE",
          files: files.length,
          audit: audit?.summary ?? AUDIT.notRun,
          projectTokens: files.reduce((sum, file) => sum + file.rawTokens, 0),
          endedAt: new Date(),
        },
      }),
    ]);
  }

  private hotspots(context: ProjectContext) {
    return context
      .topFiles(50)
      .filter((file) => file.rawTokens >= HOTSPOT_TOKENS && file.inDegree >= HOTSPOT_IMPORTERS)
      .slice(0, HOTSPOTS)
      .map((file) => ({
        relPath: file.relPath,
        rawTokens: file.rawTokens,
        inDegree: file.inDegree,
      }));
  }

  private async audit(
    root: string,
  ): Promise<{ summary: string; findings: StaticFinding[] } | null> {
    const tool = existsSync(join(root, "pnpm-lock.yaml"))
      ? "pnpm"
      : existsSync(join(root, "package-lock.json"))
        ? "npm"
        : null;
    if (!tool) return { summary: AUDIT.noLockfile, findings: [] };
    let stdout = "";
    try {
      stdout = (
        await execFileAsync(tool, ["audit", "--json"], {
          cwd: root,
          timeout: AUDIT_TIMEOUT_MS,
          maxBuffer: 20 * 1024 * 1024,
          env: { ...(this.deps.sourceEnv ?? process.env), npm_config_update_notifier: "false" },
        })
      ).stdout;
    } catch (error) {
      stdout = (error as { stdout?: string }).stdout ?? "";
      if (stdout.trim().length === 0)
        return {
          summary: interpolate(AUDIT.failed, {
            tool,
            error: (error as Error).message.split("\n")[0]?.slice(0, 160) ?? "unknown error",
          }),
          findings: [],
        };
    }
    try {
      const findings = parseNpmAudit(JSON.parse(stdout) as unknown, "package.json");
      return {
        summary: interpolate(findings.length === 1 ? AUDIT.vulnerableOne : AUDIT.vulnerableMany, {
          tool,
          count: findings.length,
        }),
        findings,
      };
    } catch {
      return { summary: interpolate(AUDIT.noJson, { tool }), findings: [] };
    }
  }
}
