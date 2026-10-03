import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "./generated/prisma/client";

export interface DatabaseOptions {
  url: string;
  busyTimeoutMs?: number;
}

const RUNTIME_PRAGMAS = [
  "PRAGMA journal_mode = WAL",
  "PRAGMA synchronous = NORMAL",
  "PRAGMA foreign_keys = ON",
  "PRAGMA temp_store = MEMORY",
] as const;

export function createPrismaClient({ url, busyTimeoutMs = 5_000 }: DatabaseOptions): PrismaClient {
  const adapter = new PrismaBetterSqlite3({ url, timeout: busyTimeoutMs });
  return new PrismaClient({ adapter });
}

export async function applyRuntimePragmas(prisma: PrismaClient): Promise<void> {
  for (const pragma of RUNTIME_PRAGMAS) {
    await prisma.$queryRawUnsafe(pragma);
  }
}

export async function connectDatabase(options: DatabaseOptions): Promise<PrismaClient> {
  const prisma = createPrismaClient(options);
  await prisma.$connect();
  await applyRuntimePragmas(prisma);
  return prisma;
}

export function sqliteFilePathFromUrl(url: string): string | null {
  if (url === ":memory:") return null;
  return url.startsWith("file:") ? url.slice("file:".length) : url;
}
