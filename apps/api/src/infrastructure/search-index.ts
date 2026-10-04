import type { PrismaClient } from "@onyx/db";

export const SEARCH_VERSION_KEY = "search.version";
export const SEARCH_VERSION = 1;

const TASK_BODY = (row: string) =>
  `substr(${row}."prompt", 1, 2000) || ' ' || coalesce(substr(${row}."resultSummary", 1, 2000), '')`;
const RUN_BODY = (row: string) =>
  `coalesce(substr(${row}."errorMessage", 1, 1000), '') || ' ' || ${row}."modelId"`;
const FILE_BODY = (row: string) =>
  `replace(replace(replace(replace(${row}."relPath", '/', ' '), '.', ' '), '-', ' '), '_', ' ')`;

const TRIGGERS = [
  "SearchEntry_task_insert",
  "SearchEntry_task_update",
  "SearchEntry_task_delete",
  "SearchEntry_run_insert",
  "SearchEntry_run_update",
  "SearchEntry_run_delete",
  "SearchEntry_file_insert",
  "SearchEntry_file_update",
  "SearchEntry_file_delete",
];

const CREATE = [
  `CREATE VIRTUAL TABLE "SearchEntry" USING fts5("kind" UNINDEXED, "refId" UNINDEXED, "projectId" UNINDEXED, "title", "body", tokenize = 'unicode61 remove_diacritics 2')`,
  `INSERT INTO "SearchEntry" ("kind", "refId", "projectId", "title", "body") SELECT 'TASK', t."id", t."projectId", t."title", ${TASK_BODY("t")} FROM "Task" t`,
  `INSERT INTO "SearchEntry" ("kind", "refId", "projectId", "title", "body") SELECT 'RUN', r."id", t."projectId", t."title", ${RUN_BODY("r")} FROM "AgentRun" r JOIN "Task" t ON t."id" = r."taskId"`,
  `INSERT INTO "SearchEntry" ("kind", "refId", "projectId", "title", "body") SELECT 'FILE', f."id", f."projectId", f."relPath", ${FILE_BODY("f")} FROM "FileNode" f`,
  `CREATE TRIGGER "SearchEntry_task_insert" AFTER INSERT ON "Task" BEGIN INSERT INTO "SearchEntry" ("kind", "refId", "projectId", "title", "body") VALUES ('TASK', NEW."id", NEW."projectId", NEW."title", ${TASK_BODY("NEW")}); END`,
  `CREATE TRIGGER "SearchEntry_task_update" AFTER UPDATE OF "title", "prompt", "resultSummary", "projectId" ON "Task" BEGIN DELETE FROM "SearchEntry" WHERE "kind" = 'TASK' AND "refId" = OLD."id"; INSERT INTO "SearchEntry" ("kind", "refId", "projectId", "title", "body") VALUES ('TASK', NEW."id", NEW."projectId", NEW."title", ${TASK_BODY("NEW")}); END`,
  `CREATE TRIGGER "SearchEntry_task_delete" AFTER DELETE ON "Task" BEGIN DELETE FROM "SearchEntry" WHERE "kind" = 'TASK' AND "refId" = OLD."id"; END`,
  `CREATE TRIGGER "SearchEntry_run_insert" AFTER INSERT ON "AgentRun" BEGIN INSERT INTO "SearchEntry" ("kind", "refId", "projectId", "title", "body") SELECT 'RUN', NEW."id", t."projectId", t."title", ${RUN_BODY("NEW")} FROM "Task" t WHERE t."id" = NEW."taskId"; END`,
  `CREATE TRIGGER "SearchEntry_run_update" AFTER UPDATE OF "errorMessage" ON "AgentRun" BEGIN DELETE FROM "SearchEntry" WHERE "kind" = 'RUN' AND "refId" = OLD."id"; INSERT INTO "SearchEntry" ("kind", "refId", "projectId", "title", "body") SELECT 'RUN', NEW."id", t."projectId", t."title", ${RUN_BODY("NEW")} FROM "Task" t WHERE t."id" = NEW."taskId"; END`,
  `CREATE TRIGGER "SearchEntry_run_delete" AFTER DELETE ON "AgentRun" BEGIN DELETE FROM "SearchEntry" WHERE "kind" = 'RUN' AND "refId" = OLD."id"; END`,
  `CREATE TRIGGER "SearchEntry_file_insert" AFTER INSERT ON "FileNode" BEGIN INSERT INTO "SearchEntry" ("kind", "refId", "projectId", "title", "body") VALUES ('FILE', NEW."id", NEW."projectId", NEW."relPath", ${FILE_BODY("NEW")}); END`,
  `CREATE TRIGGER "SearchEntry_file_update" AFTER UPDATE OF "relPath" ON "FileNode" BEGIN DELETE FROM "SearchEntry" WHERE "kind" = 'FILE' AND "refId" = OLD."id"; INSERT INTO "SearchEntry" ("kind", "refId", "projectId", "title", "body") VALUES ('FILE', NEW."id", NEW."projectId", NEW."relPath", ${FILE_BODY("NEW")}); END`,
  `CREATE TRIGGER "SearchEntry_file_delete" AFTER DELETE ON "FileNode" BEGIN DELETE FROM "SearchEntry" WHERE "kind" = 'FILE' AND "refId" = OLD."id"; END`,
];

export async function ensureSearchIndex(prisma: PrismaClient): Promise<boolean> {
  const [version, tables] = await Promise.all([
    prisma.appSetting.findUnique({ where: { key: SEARCH_VERSION_KEY } }),
    prisma.$queryRaw<
      { name: string }[]
    >`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'SearchEntry'`,
  ]);
  if (version?.value === SEARCH_VERSION && tables.length === 1) return false;
  await prisma.$transaction([
    ...TRIGGERS.map((name) => prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${name}"`)),
    prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "SearchEntry"`),
    ...CREATE.map((statement) => prisma.$executeRawUnsafe(statement)),
    prisma.appSetting.upsert({
      where: { key: SEARCH_VERSION_KEY },
      create: { key: SEARCH_VERSION_KEY, value: SEARCH_VERSION },
      update: { value: SEARCH_VERSION },
    }),
  ]);
  return true;
}

export function ftsQuery(text: string): string | null {
  const terms = text
    .normalize("NFKC")
    .split(/[\s/\\.,;:()[\]{}<>"'`|!?*^+=~-]+/)
    .map((term) => term.trim())
    .filter((term) => term.length > 0)
    .slice(0, 8);
  if (terms.length === 0) return null;
  return terms.map((term) => `"${term.replaceAll('"', '""')}"*`).join(" ");
}
