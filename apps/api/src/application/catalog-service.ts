import type { CatalogResponse } from "@onyx/contracts";
import type { PrismaClient } from "@onyx/db";
import { toAgentConfigDto, toModelProfileDto } from "./mappers";

const TIER_ORDER = { ARCHITECT: 0, BUILDER: 1, SCOUT: 2, APEX: 3 } as const;

export class CatalogService {
  constructor(private readonly prisma: PrismaClient) {}

  async catalog(): Promise<CatalogResponse> {
    const [models, agentConfigs] = await Promise.all([
      this.prisma.modelProfile.findMany(),
      this.prisma.agentConfig.findMany({ orderBy: { name: "asc" } }),
    ]);
    return {
      models: models
        .sort((left, right) => TIER_ORDER[left.tier] - TIER_ORDER[right.tier])
        .map(toModelProfileDto),
      agentConfigs: agentConfigs.map(toAgentConfigDto),
    };
  }
}
