import { access, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  CompiledPolicyDto,
  ExportResponse,
  MeasureResponse,
  ProfileState,
  SaveProfileRequestSchema,
  SuggestResponse,
  SurgeonFile,
  SurgeonStateDto,
  TokenCalibration,
} from "@onyx/contracts";
import { DEFAULT_AGENT_CONFIG_NAME, Prisma, type PrismaClient } from "@onyx/db";
import {
  compilePolicy,
  ContextPolicy,
  normalizePattern,
  parseIgnoreFile,
  PathGuard,
  policyHash,
  presetRules,
  renderIgnoreFile,
  SECURITY_RULES,
  suggestRules,
  type CompiledPolicy,
  type PolicyRule,
} from "@onyx/ignore-compiler";
import type { Logger } from "pino";
import type { z } from "zod";
import { badRequest, notFound } from "../errors";
import { stableSample, type CalibrationService } from "./calibration-service";
import type { IndexService } from "./index-service";
import type { ProjectContext } from "./project-context";

type SaveInput = z.output<typeof SaveProfileRequestSchema>;

export const CLAUDESIGNORE_FILE = ".claudesignore";
const BASE_PROFILE_NAME = "default";
const MEASURE_CHAR_BUDGET = 3_000_000;

const PROFILE_INCLUDE = { rules: { orderBy: { position: "asc" as const } } } as const;
type ProfileWithRules = Prisma.IgnoreProfileGetPayload<{ include: typeof PROFILE_INCLUDE }>;

export interface RunScope {
  policy: ContextPolicy;
  hash: string;
  compiled: CompiledPolicy;
  guard: PathGuard;
}

export interface SurgeonServiceDeps {
  prisma: PrismaClient;
  indexes: IndexService;
  calibration: CalibrationService;
  logger: Logger;
}

function toPolicyRule(row: ProfileWithRules["rules"][number]): PolicyRule {
  return {
    pattern: row.pattern,
    action: row.action,
    source: row.source,
    locked: row.locked,
    reason: row.reason,
  };
}

function toProfileState(profile: ProfileWithRules | null): ProfileState {
  return {
    id: profile?.id ?? null,
    version: profile?.version ?? 0,
    compiledHash: profile?.compiledHash ?? null,
    compiledAt: profile?.compiledAt?.toISOString() ?? null,
    rules: (profile?.rules ?? []).map(toPolicyRule),
  };
}

function dedupe(rules: readonly PolicyRule[]): PolicyRule[] {
  const seen = new Set<string>();
  return rules.filter((candidate) => {
    const key = `${candidate.action}:${candidate.pattern}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}

export class SurgeonService {
  constructor(private readonly deps: SurgeonServiceDeps) {}

  async baseProfile(projectId: string): Promise<ProfileWithRules> {
    const { prisma } = this.deps;
    const active = await prisma.ignoreProfile.findFirst({
      where: { projectId, isActive: true },
      include: PROFILE_INCLUDE,
    });
    if (active) return active;
    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw notFound("Project");
    const imported = await readFile(join(project.rootPath, CLAUDESIGNORE_FILE), "utf8")
      .then((text) => parseIgnoreFile(text))
      .catch(() => []);
    const securityPatterns = new Set(SECURITY_RULES.map((rule) => rule.pattern));
    const rules = dedupe([
      ...presetRules("aggressive"),
      ...imported.filter((rule) => !securityPatterns.has(rule.pattern)),
    ]);
    try {
      return await prisma.ignoreProfile.create({
        data: {
          projectId,
          name: BASE_PROFILE_NAME,
          preset: "aggressive",
          isActive: true,
          rules: {
            create: rules.map((rule, position) => ({
              position,
              pattern: rule.pattern,
              action: rule.action,
              source: rule.source,
              reason: rule.reason,
            })),
          },
        },
        include: PROFILE_INCLUDE,
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const existing = await prisma.ignoreProfile.findFirst({
          where: { projectId, name: BASE_PROFILE_NAME },
          include: PROFILE_INCLUDE,
        });
        if (existing) return existing;
      }
      throw error;
    }
  }

  async overlayProfile(workspaceId: string | null): Promise<ProfileWithRules | null> {
    if (workspaceId === null) return null;
    const workspace = await this.deps.prisma.workspace.findUnique({
      where: { id: workspaceId },
      include: { ignoreProfile: { include: PROFILE_INCLUDE } },
    });
    if (!workspace) throw notFound("Workspace");
    return workspace.ignoreProfile;
  }

  async effectivePolicy(projectId: string, workspaceId: string | null): Promise<ContextPolicy> {
    const [base, overlay] = await Promise.all([
      this.baseProfile(projectId),
      this.overlayProfile(workspaceId),
    ]);
    return ContextPolicy.compose(
      base.rules.map(toPolicyRule),
      (overlay?.rules ?? []).map(toPolicyRule),
      SECURITY_RULES,
    );
  }

  async runScope(
    projectId: string,
    workspaceId: string | null,
    rootOverride: string | null = null,
  ): Promise<RunScope> {
    const [policy, context, project] = await Promise.all([
      this.effectivePolicy(projectId, workspaceId),
      this.deps.indexes.context(projectId),
      this.deps.prisma.project.findUnique({ where: { id: projectId }, select: { rootPath: true } }),
    ]);
    if (!project) throw notFound("Project");
    const files = context ? [...context.index.files.keys()] : [];
    const root = rootOverride ?? project.rootPath;
    return {
      policy,
      hash: policyHash(policy),
      compiled: compilePolicy(policy, {
        projectRoot: root,
        ...(context ? { files } : {}),
      }),
      guard: new PathGuard(policy, root, files),
    };
  }

  async state(projectId: string, workspaceId: string | null): Promise<SurgeonStateDto> {
    const { prisma, indexes, calibration } = this.deps;
    const [base, overlay, context, project] = await Promise.all([
      this.baseProfile(projectId),
      this.overlayProfile(workspaceId),
      indexes.context(projectId),
      prisma.project.findUnique({ where: { id: projectId } }),
    ]);
    if (!project) throw notFound("Project");
    const claudesignorePath = join(project.rootPath, CLAUDESIGNORE_FILE);
    return {
      projectId,
      workspaceId,
      indexedAt: context?.indexedAt?.toISOString() ?? null,
      base: toProfileState(base),
      overlay: workspaceId === null ? null : toProfileState(overlay),
      securityRules: SECURITY_RULES.map((rule) => ({ ...rule })),
      files: context ? this.files(context) : [],
      pricing: await this.pricing(projectId, workspaceId),
      calibration: calibration.calibration,
      claudesignorePath,
      claudesignoreExists: await exists(claudesignorePath),
    };
  }

  async save(projectId: string, input: SaveInput, actor: string): Promise<SurgeonStateDto> {
    const { prisma, logger } = this.deps;
    const rules: PolicyRule[] = [];
    for (const entry of input.rules) {
      const pattern = normalizePattern(entry.pattern);
      if (pattern === null) throw badRequest(`Invalid pattern: ${entry.pattern}`);
      rules.push({
        pattern,
        action: entry.action,
        source: entry.source,
        locked: false,
        reason: entry.reason,
      });
    }
    const unique = dedupe(rules);
    const base = await this.baseProfile(projectId);
    let profileId = base.id;
    let previous = base.rules.map(toPolicyRule);

    if (input.workspaceId !== null) {
      const workspace = await prisma.workspace.findUnique({ where: { id: input.workspaceId } });
      if (!workspace || workspace.projectId !== projectId) {
        throw badRequest("Workspace does not belong to the project");
      }
      const overlay = await this.overlayProfile(workspace.id);
      if (overlay) {
        profileId = overlay.id;
        previous = overlay.rules.map(toPolicyRule);
      } else {
        const created = await prisma.ignoreProfile.create({
          data: { projectId, name: `workspace:${workspace.id}`, isActive: false },
        });
        await prisma.workspace.update({
          where: { id: workspace.id },
          data: { ignoreProfileId: created.id },
        });
        profileId = created.id;
        previous = [];
      }
    }

    const policy = await this.policyWith(projectId, input.workspaceId, profileId, unique);
    const context = await this.deps.indexes.context(projectId);
    const savedTokens = context
      ? [...context.index.files.values()]
          .filter((file) => policy.isExcluded(file.relPath))
          .reduce((sum, file) => sum + file.rawTokens, 0)
      : null;

    await prisma.$transaction(async (tx) => {
      await tx.ignoreRule.deleteMany({ where: { profileId } });
      if (unique.length > 0) {
        await tx.ignoreRule.createMany({
          data: unique.map((rule, position) => ({
            profileId,
            position,
            pattern: rule.pattern,
            action: rule.action,
            source: rule.source,
            reason: rule.reason,
          })),
        });
      }
      await tx.ignoreProfile.update({
        where: { id: profileId },
        data: {
          version: { increment: 1 },
          compiledHash: policyHash(policy),
          compiledAt: new Date(),
          estimatedSavedTokens: savedTokens,
        },
      });
      const before = new Set(previous.map((rule) => `${rule.action}:${rule.pattern}`));
      const after = new Set(unique.map((rule) => `${rule.action}:${rule.pattern}`));
      await tx.auditLog.create({
        data: {
          actor,
          action: "surgeon.save",
          target: profileId,
          meta: {
            projectId,
            workspaceId: input.workspaceId,
            added: [...after].filter((key) => !before.has(key)),
            removed: [...before].filter((key) => !after.has(key)),
            estimatedSavedTokens: savedTokens,
          },
        },
      });
    });
    logger.info({ projectId, profileId, rules: unique.length }, "Context profile saved");
    return this.state(projectId, input.workspaceId);
  }

  async suggest(projectId: string, workspaceId: string | null): Promise<SuggestResponse> {
    const [base, overlay, context] = await Promise.all([
      this.baseProfile(projectId),
      this.overlayProfile(workspaceId),
      this.deps.indexes.context(projectId),
    ]);
    const existing = [
      ...base.rules.map(toPolicyRule),
      ...(overlay?.rules ?? []).map(toPolicyRule),
      ...SECURITY_RULES,
    ];
    const stats = context
      ? this.files(context).map((file) => ({
          relPath: file.path,
          sizeBytes: file.sizeBytes,
          rawTokens: file.rawTokens,
          binary: file.binary,
          centrality: file.centrality,
        }))
      : [];
    return {
      items: suggestRules(stats, existing, presetRules("aggressive")).map((suggestion) => ({
        ...suggestion,
        rule: { ...suggestion.rule },
      })),
    };
  }

  async compile(projectId: string, workspaceId: string | null): Promise<CompiledPolicyDto> {
    const [scope, base, overlay, context] = await Promise.all([
      this.runScope(projectId, workspaceId),
      this.baseProfile(projectId),
      this.overlayProfile(workspaceId),
      this.deps.indexes.context(projectId),
    ]);
    const excluded = context
      ? [...context.index.files.values()].filter((file) => scope.policy.isExcluded(file.relPath))
      : [];
    return {
      ...scope.compiled,
      claudesignore: renderIgnoreFile([
        ...base.rules.map(toPolicyRule),
        ...(overlay?.rules ?? []).map(toPolicyRule),
      ]),
      excludedFiles: excluded.length,
      excludedTokens: excluded.reduce((sum, file) => sum + file.rawTokens, 0),
    };
  }

  async measure(projectId: string, workspaceId: string | null): Promise<MeasureResponse> {
    const [policy, context] = await Promise.all([
      this.effectivePolicy(projectId, workspaceId),
      this.requireContext(projectId),
    ]);
    const excluded = [...context.index.files.values()].filter(
      (file) => !file.binary && policy.isExcluded(file.relPath),
    );
    const texts: string[] = [];
    let estimatedTokens = 0;
    let chars = 0;
    for (const file of stableSample(excluded)) {
      if (chars >= MEASURE_CHAR_BUDGET) break;
      const content = context.readSource(file.relPath);
      if (content === null) continue;
      texts.push(content);
      chars += content.length;
      estimatedTokens += file.rawTokens;
    }
    const counts = await this.deps.calibration.measure(texts);
    const measuredTokens = counts.reduce((sum, count) => sum + count, 0);
    return {
      reference: this.deps.calibration.referenceName,
      excludedFiles: excluded.length,
      sampledFiles: texts.length,
      estimatedTokens,
      measuredTokens,
      error: measuredTokens === 0 ? 0 : estimatedTokens / measuredTokens - 1,
      calibrated: this.deps.calibration.calibration !== null,
    };
  }

  async calibrate(projectId: string): Promise<TokenCalibration> {
    const context = await this.requireContext(projectId);
    const samples = stableSample(
      [...context.index.files.values()].filter((file) => !file.binary && !file.sensitive),
    ).flatMap((file) => {
      const text = context.readSource(file.relPath);
      return text === null ? [] : [{ kind: file.language, text }];
    });
    const calibration = await this.deps.calibration.calibrate(samples);
    await this.deps.indexes.start(projectId);
    return calibration;
  }

  async export(projectId: string, actor: string): Promise<ExportResponse> {
    const project = await this.deps.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw notFound("Project");
    const base = await this.baseProfile(projectId);
    const path = join(project.rootPath, CLAUDESIGNORE_FILE);
    await writeFile(path, renderIgnoreFile(base.rules.map(toPolicyRule)));
    await this.deps.prisma.auditLog.create({
      data: { actor, action: "surgeon.export", target: path, meta: { rules: base.rules.length } },
    });
    return { path, rules: base.rules.length };
  }

  private files(context: ProjectContext): SurgeonFile[] {
    return [...context.index.files.values()]
      .map((file) => ({
        path: file.relPath,
        kind: file.language,
        sizeBytes: file.sizeBytes,
        rawTokens: file.rawTokens,
        l1Tokens: file.analysis?.l1Tokens ?? null,
        binary: file.binary,
        sensitive: file.sensitive,
        domain: file.domain,
        centrality: file.centrality,
      }))
      .sort((a, b) => a.path.localeCompare(b.path));
  }

  private async requireContext(projectId: string): Promise<ProjectContext> {
    const context = await this.deps.indexes.context(projectId);
    if (!context) throw badRequest("Index the project first");
    return context;
  }

  private async policyWith(
    projectId: string,
    workspaceId: string | null,
    editedProfileId: string,
    rules: readonly PolicyRule[],
  ): Promise<ContextPolicy> {
    const base = await this.baseProfile(projectId);
    const editingBase = base.id === editedProfileId;
    const overlay =
      workspaceId === null || !editingBase ? null : await this.overlayProfile(workspaceId);
    const baseRules = editingBase ? rules : base.rules.map(toPolicyRule);
    const overlayRules =
      workspaceId === null ? [] : editingBase ? (overlay?.rules ?? []).map(toPolicyRule) : rules;
    return ContextPolicy.compose(baseRules, overlayRules, SECURITY_RULES);
  }

  private async pricing(
    projectId: string,
    workspaceId: string | null,
  ): Promise<SurgeonStateDto["pricing"]> {
    const { prisma } = this.deps;
    const workspace = workspaceId
      ? await prisma.workspace.findUnique({
          where: { id: workspaceId },
          include: { agentConfig: true },
        })
      : await prisma.workspace.findFirst({
          where: { projectId },
          orderBy: { position: "asc" },
          include: { agentConfig: true },
        });
    const agentConfig =
      workspace?.agentConfig ??
      (await prisma.agentConfig.findUnique({ where: { name: DEFAULT_AGENT_CONFIG_NAME } }));
    if (!agentConfig) return null;
    const profile = await prisma.modelProfile.findUnique({ where: { id: agentConfig.modelId } });
    return profile ? { modelId: profile.id, inputUsdPerMTok: profile.inputUsdPerMTok } : null;
  }
}
