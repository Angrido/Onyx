import type { Domain } from "@onyx/contracts";

export const DOMAIN_LABELS: Record<Domain, string> = {
  FRONTEND: "Frontend",
  BACKEND: "Backend",
  DATABASE: "Database",
  INFRA: "Infra",
  CUSTOM: "Custom",
};

export const DOMAIN_COLORS: Record<Domain | "SHARED", string> = {
  FRONTEND: "oklch(0.8 0.12 210)",
  BACKEND: "oklch(0.72 0.17 293)",
  DATABASE: "oklch(0.8 0.15 75)",
  INFRA: "oklch(0.76 0.16 155)",
  CUSTOM: "oklch(0.75 0.13 340)",
  SHARED: "oklch(0.62 0.015 286)",
};

export function domainColor(domain: Domain | null): string {
  return DOMAIN_COLORS[domain ?? "SHARED"];
}
