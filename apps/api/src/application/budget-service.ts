import type {
  BudgetDto,
  CreateBudgetRequestSchema,
  UpdateBudgetRequestSchema,
} from "@onyx/contracts";
import type { Budget, PrismaClient } from "@onyx/db";
import type { Logger } from "pino";
import type { z } from "zod";
import { budgetLevel, periodKey, periodStart, type BudgetLevel } from "../domain/budget";
import { badRequest, notFound } from "../errors";
import { interpolate, msg, tx, txKnown } from "../i18n";
import type { ApprovalService } from "./approval-service";

type CreateInput = z.output<typeof CreateBudgetRequestSchema>;
type UpdateInput = z.output<typeof UpdateBudgetRequestSchema>;

export type AdmitDecision =
  { decision: "go" } | { decision: "hold"; reason: string } | { decision: "deny"; reason: string };

interface BudgetState {
  budget: Budget;
  spentUsd: number;
  level: BudgetLevel;
  periodKey: string;
  softApproved: boolean;
}

export interface BudgetServiceDeps {
  prisma: PrismaClient;
  logger: Logger;
  approvals: Pick<ApprovalService, "create" | "register" | "expire">;
  now?: () => Date;
  onHardLimit?: (projectId: string | null, reason: string, notice: string) => void;
  onChange?: () => void;
}

function money(value: number): string {
  return `$${value.toFixed(2)}`;
}

const BUDGET_TEXT = {
  allProjects: msg("All projects"),
  project: msg("Project"),
  softTitle: msg("{label}: soft budget of {amount} passed"),
  softDetail: msg(
    "Spent {spent} in {period}. New runs in this scope wait until you approve; the hard limit is {hard}.",
  ),
} as const;

const BUDGET_TEXT_KEYS: readonly string[] = [
  BUDGET_TEXT.softTitle,
  BUDGET_TEXT.softDetail,
  BUDGET_TEXT.allProjects,
  BUDGET_TEXT.project,
];

function scopeLabel(budget: Budget, projectName: string | null): string {
  return budget.scope === "GLOBAL" ? BUDGET_TEXT.allProjects : (projectName ?? BUDGET_TEXT.project);
}

export class BudgetService {
  private states: BudgetState[] = [];
  private names = new Map<string, string>();
  private refreshing: Promise<void> = Promise.resolve();

  constructor(private readonly deps: BudgetServiceDeps) {
    deps.approvals.register(
      "BUDGET",
      {
        approve: async (_approval, payload) => {
          if (!payload.budgetId || !payload.periodKey) return;
          await this.deps.prisma.budget
            .update({
              where: { id: payload.budgetId },
              data: { approvedPeriod: payload.periodKey },
            })
            .catch(() => undefined);
          await this.refresh();
          this.deps.onChange?.();
        },
        reject: async () => {
          await this.refresh();
        },
      },
      (text) => txKnown(text, BUDGET_TEXT_KEYS),
    );
  }

  async list(): Promise<BudgetDto[]> {
    await this.refresh();
    return this.states.map((state) => this.toDto(state));
  }

  async create(input: CreateInput): Promise<BudgetDto> {
    if (input.scope === "PROJECT") {
      if (!input.projectId) throw badRequest("Choose the project of the budget");
      const project = await this.deps.prisma.project.findUnique({ where: { id: input.projectId } });
      if (!project) throw notFound("Project");
    }
    const budget = await this.deps.prisma.budget.create({
      data: {
        scope: input.scope,
        projectId: input.scope === "PROJECT" ? input.projectId : null,
        period: input.period,
        softUsd: input.softUsd,
        hardUsd: input.hardUsd,
        enabled: input.enabled,
      },
    });
    await this.refresh();
    this.deps.onChange?.();
    return this.dtoFor(budget.id);
  }

  async update(id: string, input: UpdateInput): Promise<BudgetDto> {
    const existing = await this.deps.prisma.budget.findUnique({ where: { id } });
    if (!existing) throw notFound("Budget");
    const softUsd = input.softUsd === undefined ? existing.softUsd : input.softUsd;
    const hardUsd = input.hardUsd ?? existing.hardUsd;
    if (softUsd !== null && softUsd >= hardUsd)
      throw badRequest("The soft limit must be lower than the hard limit");
    await this.deps.prisma.budget.update({
      where: { id },
      data: {
        softUsd,
        hardUsd,
        ...(input.period ? { period: input.period, approvedPeriod: null } : {}),
        ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
      },
    });
    await this.refresh();
    this.deps.onChange?.();
    return this.dtoFor(id);
  }

  async remove(id: string): Promise<void> {
    const existing = await this.deps.prisma.budget.findUnique({ where: { id } });
    if (!existing) throw notFound("Budget");
    await this.deps.prisma.budget.delete({ where: { id } });
    await this.deps.approvals.expire((payload) => payload.budgetId === id);
    await this.refresh();
    this.deps.onChange?.();
  }

  admit(projectId: string | null): AdmitDecision {
    for (const state of this.states) {
      if (!this.covers(state.budget, projectId)) continue;
      const label = scopeLabel(state.budget, this.names.get(state.budget.projectId ?? "") ?? null);
      if (state.level === "hard")
        return {
          decision: "deny",
          reason: `${label} reached the hard budget of ${money(state.budget.hardUsd)} for ${state.periodKey} (spent ${money(state.spentUsd)})`,
        };
      if (state.level === "soft" && !state.softApproved)
        return {
          decision: "hold",
          reason: `${label} passed the soft budget of ${money(state.budget.softUsd ?? 0)}: approve it in Approvals to continue`,
        };
    }
    return { decision: "go" };
  }

  refresh(): Promise<void> {
    const next = this.refreshing.then(() => this.compute());
    this.refreshing = next.catch((error: unknown) =>
      this.deps.logger.warn({ err: error }, "Budget refresh failed"),
    );
    return next;
  }

  private async compute(): Promise<void> {
    const { prisma, logger } = this.deps;
    const now = this.deps.now?.() ?? new Date();
    const all = await prisma.budget.findMany({
      include: { project: { select: { name: true } } },
      orderBy: { createdAt: "asc" },
    });
    const previous = new Map(this.states.map((state) => [state.budget.id, state.level]));
    const states: BudgetState[] = [];
    for (const budget of all) {
      const key = periodKey(budget.period, now);
      const spentUsd = await this.spent(budget, now);
      states.push({
        budget,
        spentUsd,
        level: budget.enabled ? budgetLevel(budget, spentUsd) : "ok",
        periodKey: key,
        softApproved: budget.approvedPeriod === key,
      });
    }
    this.names = new Map(
      all
        .filter((budget) => budget.projectId !== null && budget.project)
        .map((budget) => [budget.projectId ?? "", budget.project?.name ?? ""]),
    );
    this.states = states;
    for (const state of states) {
      if (!state.budget.enabled) continue;
      const label = scopeLabel(state.budget, this.names.get(state.budget.projectId ?? "") ?? null);
      if (state.level === "soft" && !state.softApproved) {
        await this.deps.approvals.create({
          kind: "BUDGET",
          title: interpolate(BUDGET_TEXT.softTitle, {
            label,
            amount: money(state.budget.softUsd ?? 0),
          }),
          projectId: state.budget.projectId,
          payload: {
            key: `budget:${state.budget.id}:${state.periodKey}`,
            budgetId: state.budget.id,
            periodKey: state.periodKey,
            detail: interpolate(BUDGET_TEXT.softDetail, {
              spent: money(state.spentUsd),
              period: state.periodKey,
              hard: money(state.budget.hardUsd),
            }),
            link: "/settings",
            approveLabel: "Continue this period",
            rejectLabel: "Keep runs paused",
          },
        });
      }
      if (state.level === "hard" && previous.get(state.budget.id) !== "hard") {
        const reason = `${label} reached the hard budget of ${money(state.budget.hardUsd)}`;
        logger.warn({ budgetId: state.budget.id, spent: state.spentUsd }, reason);
        this.deps.onHardLimit?.(
          state.budget.scope === "GLOBAL" ? null : state.budget.projectId,
          reason,
          this.hardNotice(state),
        );
      }
    }
  }

  private hardNotice(state: BudgetState): string {
    const amount = money(state.budget.hardUsd);
    if (state.budget.scope === "GLOBAL")
      return tx("All projects reached the hard budget of {amount}", { amount });
    return tx("{project} reached the hard budget of {amount}", {
      project: this.names.get(state.budget.projectId ?? "") ?? tx(BUDGET_TEXT.project),
      amount,
    });
  }

  private covers(budget: Budget, projectId: string | null): boolean {
    if (!budget.enabled) return false;
    return budget.scope === "GLOBAL" || (projectId !== null && budget.projectId === projectId);
  }

  private async spent(budget: Budget, now: Date): Promise<number> {
    const start = periodStart(budget.period, now);
    const createdAt = start ? { gte: start } : undefined;
    const prisma = this.deps.prisma;
    if (budget.scope === "PROJECT" && budget.projectId) {
      const projectId = budget.projectId;
      const [runs, planners, roadmaps] = await Promise.all([
        prisma.tokenLog.aggregate({
          _sum: { costUsd: true },
          where: {
            scope: "RUN_TOTAL",
            ...(createdAt ? { createdAt } : {}),
            run: { task: { projectId } },
          },
        }),
        prisma.orchestration.aggregate({
          _sum: { plannerCostUsd: true },
          where: { projectId, ...(createdAt ? { createdAt } : {}) },
        }),
        prisma.roadmapGeneration.aggregate({
          _sum: { costUsd: true },
          where: { projectId, ...(start ? { startedAt: { gte: start } } : {}) },
        }),
      ]);
      return (
        (runs._sum.costUsd ?? 0) +
        (planners._sum.plannerCostUsd ?? 0) +
        (roadmaps._sum.costUsd ?? 0)
      );
    }
    const total = await prisma.tokenLog.aggregate({
      _sum: { costUsd: true },
      where: { scope: { in: ["RUN_TOTAL", "AUX"] }, ...(createdAt ? { createdAt } : {}) },
    });
    return total._sum.costUsd ?? 0;
  }

  private async dtoFor(id: string): Promise<BudgetDto> {
    const state = this.states.find((entry) => entry.budget.id === id);
    if (!state) throw notFound("Budget");
    return this.toDto(state);
  }

  private toDto(state: BudgetState): BudgetDto {
    const { budget } = state;
    return {
      id: budget.id,
      scope: budget.scope,
      projectId: budget.projectId,
      projectName: budget.projectId ? (this.names.get(budget.projectId) ?? null) : null,
      period: budget.period,
      softUsd: budget.softUsd,
      hardUsd: budget.hardUsd,
      enabled: budget.enabled,
      spentUsd: Math.round(state.spentUsd * 10_000) / 10_000,
      level: state.level,
      softApproved: state.softApproved,
      periodKey: state.periodKey,
    };
  }
}
