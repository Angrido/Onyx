import type { PrismaClient } from "./generated/prisma/client";
import { AGENT_CONFIGS, APP_SETTINGS, MODEL_PROFILES, ROUTING_RULES } from "./seed-data";

export interface SeedReport {
  modelProfiles: number;
  agentConfigs: number;
  routingRules: number;
  appSettings: number;
}

export async function seedDatabase(prisma: PrismaClient): Promise<SeedReport> {
  const report: SeedReport = { modelProfiles: 0, agentConfigs: 0, routingRules: 0, appSettings: 0 };

  for (const profile of MODEL_PROFILES) {
    const existing = await prisma.modelProfile.findUnique({ where: { id: profile.id } });
    if (existing) continue;
    await prisma.modelProfile.create({ data: profile });
    report.modelProfiles += 1;
  }

  for (const config of AGENT_CONFIGS) {
    const existing = await prisma.agentConfig.findUnique({ where: { name: config.name } });
    if (existing) continue;
    await prisma.agentConfig.create({ data: { ...config, isBuiltin: true } });
    report.agentConfigs += 1;
  }

  for (const rule of ROUTING_RULES) {
    const existing = await prisma.routingRule.findFirst({
      where: { projectId: null, name: rule.name },
    });
    if (existing) continue;
    await prisma.routingRule.create({ data: rule });
    report.routingRules += 1;
  }

  for (const [key, value] of Object.entries(APP_SETTINGS)) {
    const existing = await prisma.appSetting.findUnique({ where: { key } });
    if (existing) continue;
    await prisma.appSetting.create({ data: { key, value: value as object } });
    report.appSettings += 1;
  }

  return report;
}
