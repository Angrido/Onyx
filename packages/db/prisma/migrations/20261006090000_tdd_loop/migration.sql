PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_TddIteration" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "loopId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "scope" TEXT NOT NULL,
    "passed" INTEGER NOT NULL,
    "failed" INTEGER NOT NULL,
    "skipped" INTEGER NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "failureSignature" TEXT,
    "digest" TEXT,
    "digestTokens" INTEGER,
    "rawLogPath" TEXT,
    "agentRunId" TEXT,
    "escalated" BOOLEAN NOT NULL DEFAULT false,
    "regressions" INTEGER NOT NULL DEFAULT 0,
    "revertedFiles" JSONB,
    "exitCode" INTEGER,
    "timedOut" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TddIteration_loopId_fkey" FOREIGN KEY ("loopId") REFERENCES "TddLoop" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TddIteration_agentRunId_fkey" FOREIGN KEY ("agentRunId") REFERENCES "AgentRun" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_TddIteration" ("agentRunId", "createdAt", "digest", "digestTokens", "durationMs", "escalated", "failed", "failureSignature", "id", "index", "loopId", "passed", "rawLogPath", "scope", "skipped") SELECT "agentRunId", "createdAt", "digest", "digestTokens", "durationMs", "escalated", "failed", "failureSignature", "id", "index", "loopId", "passed", "rawLogPath", "scope", "skipped" FROM "TddIteration";
DROP TABLE "TddIteration";
ALTER TABLE "new_TddIteration" RENAME TO "TddIteration";
CREATE UNIQUE INDEX "TddIteration_agentRunId_key" ON "TddIteration"("agentRunId");
CREATE UNIQUE INDEX "TddIteration_loopId_index_key" ON "TddIteration"("loopId", "index");
CREATE TABLE "new_TddLoop" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "runner" TEXT NOT NULL,
    "relatedCommand" TEXT NOT NULL,
    "fullCommand" TEXT NOT NULL,
    "gates" JSONB NOT NULL,
    "maxIterations" INTEGER NOT NULL DEFAULT 6,
    "budgetUsd" REAL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "iterationCount" INTEGER NOT NULL DEFAULT 0,
    "protectedHash" TEXT,
    "protectedFiles" INTEGER NOT NULL DEFAULT 0,
    "violations" INTEGER NOT NULL DEFAULT 0,
    "relatedFiles" JSONB,
    "testTimeoutSec" INTEGER NOT NULL DEFAULT 300,
    "costUsd" REAL NOT NULL DEFAULT 0,
    "message" TEXT,
    "escalatedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" DATETIME,
    "endedAt" DATETIME,
    "greenAt" DATETIME,
    CONSTRAINT "TddLoop_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TddLoop_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_TddLoop" ("budgetUsd", "endedAt", "fullCommand", "gates", "greenAt", "id", "iterationCount", "maxIterations", "protectedHash", "relatedCommand", "runner", "startedAt", "status", "taskId", "violations", "workspaceId") SELECT "budgetUsd", "endedAt", "fullCommand", "gates", "greenAt", "id", "iterationCount", "maxIterations", "protectedHash", "relatedCommand", "runner", "startedAt", "status", "taskId", "violations", "workspaceId" FROM "TddLoop";
DROP TABLE "TddLoop";
ALTER TABLE "new_TddLoop" RENAME TO "TddLoop";
CREATE INDEX "TddLoop_taskId_idx" ON "TddLoop"("taskId");
CREATE INDEX "TddLoop_status_idx" ON "TddLoop"("status");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

