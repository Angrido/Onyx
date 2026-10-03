export type BudgetPeriodName = "DAY" | "MONTH" | "LIFETIME";
export type BudgetLevel = "ok" | "soft" | "hard";

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function periodKey(period: BudgetPeriodName, now: Date): string {
  if (period === "DAY")
    return `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}`;
  if (period === "MONTH") return `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}`;
  return "lifetime";
}

export function periodStart(period: BudgetPeriodName, now: Date): Date | null {
  if (period === "DAY")
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (period === "MONTH") return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return null;
}

export function budgetLevel(
  budget: { softUsd: number | null; hardUsd: number },
  spentUsd: number,
): BudgetLevel {
  if (spentUsd >= budget.hardUsd) return "hard";
  if (budget.softUsd !== null && spentUsd >= budget.softUsd) return "soft";
  return "ok";
}
