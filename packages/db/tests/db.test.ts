import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DomainSchema,
  ModelTierSchema,
  RunStatusSchema,
  SessionEndReasonSchema,
  SessionStatusSchema,
  TaskKindSchema,
  TaskStatusSchema,
} from "@onyx/contracts";
import { connectDatabase, DbEnums, seedDatabase, type PrismaClient } from "../src";
import { createTestDatabase, type TestDatabase } from "../src/testing";

describe("enum parity between Prisma and contracts", () => {
  it.each([
    ["Domain", DbEnums.Domain, DomainSchema.options],
    ["ModelTier", DbEnums.ModelTier, ModelTierSchema.options],
    ["TaskKind", DbEnums.TaskKind, TaskKindSchema.options],
    ["TaskStatus", DbEnums.TaskStatus, TaskStatusSchema.options],
    ["RunStatus", DbEnums.RunStatus, RunStatusSchema.options],
    ["SessionStatus", DbEnums.SessionStatus, SessionStatusSchema.options],
    ["SessionEndReason", DbEnums.SessionEndReason, SessionEndReasonSchema.options],
  ])("%s", (_name, prismaEnum, contractValues) => {
    expect(Object.values(prismaEnum).sort()).toEqual([...contractValues].sort());
  });
});

describe("database", () => {
  let database: TestDatabase;
  let prisma: PrismaClient;

  beforeEach(async () => {
    database = createTestDatabase();
    prisma = await connectDatabase({ url: database.url });
  });

  afterEach(async () => {
    await prisma.$disconnect();
    database.cleanup();
  });

  it("applies runtime pragmas", async () => {
    const journal =
      await prisma.$queryRawUnsafe<Array<{ journal_mode: string }>>("PRAGMA journal_mode");
    const foreignKeys =
      await prisma.$queryRawUnsafe<Array<{ foreign_keys: bigint | number }>>("PRAGMA foreign_keys");
    expect(journal[0]?.journal_mode).toBe("wal");
    expect(Number(foreignKeys[0]?.foreign_keys)).toBe(1);
  });

  it("seeds idempotently", async () => {
    const first = await seedDatabase(prisma);
    const second = await seedDatabase(prisma);
    expect(first.modelProfiles).toBe(4);
    expect(first.agentConfigs).toBe(5);
    expect(first.routingRules).toBe(7);
    expect(second).toEqual({ modelProfiles: 0, agentConfigs: 0, routingRules: 0, appSettings: 0 });
    const fable = await prisma.modelProfile.findUniqueOrThrow({
      where: { id: "claude-fable-5-1" },
    });
    expect(fable.enabled).toBe(false);
  });

  it("preserves operator edits when reseeding", async () => {
    await seedDatabase(prisma);
    await prisma.modelProfile.update({
      where: { id: "claude-sonnet-5-5" },
      data: { inputUsdPerMTok: 1.5 },
    });
    await seedDatabase(prisma);
    const sonnet = await prisma.modelProfile.findUniqueOrThrow({
      where: { id: "claude-sonnet-5-5" },
    });
    expect(sonnet.inputUsdPerMTok).toBe(1.5);
  });

  it("cascades project deletion to workspaces and tasks", async () => {
    const project = await prisma.project.create({
      data: { name: "demo", rootPath: "/tmp/demo" },
    });
    const workspace = await prisma.workspace.create({
      data: {
        projectId: project.id,
        name: "Frontend",
        domain: "FRONTEND",
        pathGlobs: ["apps/web/**"],
        writeFenceGlobs: ["apps/web/**"],
      },
    });
    await prisma.task.create({
      data: {
        projectId: project.id,
        workspaceId: workspace.id,
        title: "t",
        prompt: "p",
        kind: "FEATURE",
      },
    });
    await prisma.project.delete({ where: { id: project.id } });
    expect(await prisma.workspace.count()).toBe(0);
    expect(await prisma.task.count()).toBe(0);
  });
});
