import type { Domain } from "@onyx/contracts";
import { msg } from "@/lib/i18n/core";

export const DOMAIN_LABELS: Record<Domain, string> = {
  FRONTEND: msg("Frontend"),
  BACKEND: msg("Backend"),
  DATABASE: msg("Database"),
  INFRA: msg("Infra"),
  CUSTOM: msg("Custom"),
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
