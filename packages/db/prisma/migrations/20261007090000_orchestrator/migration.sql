ALTER TABLE "Budget" ADD COLUMN "approvedPeriod" TEXT;

ALTER TABLE "Task" ADD COLUMN "mergeCommit" TEXT;
ALTER TABLE "Task" ADD COLUMN "mergeState" TEXT;
ALTER TABLE "Task" ADD COLUMN "mergedAt" DATETIME;
ALTER TABLE "Task" ADD COLUMN "planKey" TEXT;

CREATE TABLE "Orchestration" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "rootTaskId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PLANNING',
    "goal" TEXT NOT NULL,
    "summary" TEXT,
    "plan" JSONB,
    "baseBranch" TEXT,
    "baseCommit" TEXT,
    "workBranch" TEXT,
    "integrationPath" TEXT,
    "parallelism" INTEGER NOT NULL DEFAULT 2,
    "verify" BOOLEAN NOT NULL DEFAULT true,
    "plannerModelId" TEXT,
    "plannerCostUsd" REAL,
    "plannerTurns" INTEGER,
    "message" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedAt" DATETIME,
    "startedAt" DATETIME,
    "endedAt" DATETIME,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Orchestration_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Orchestration_rootTaskId_fkey" FOREIGN KEY ("rootTaskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Approval" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskId" TEXT,
    "projectId" TEXT,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "title" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "decidedBy" TEXT,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" DATETIME,
    "expiresAt" DATETIME,
    CONSTRAINT "Approval_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Approval_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Approval" ("createdAt", "decidedAt", "decidedBy", "expiresAt", "id", "kind", "note", "payload", "status", "taskId", "title") SELECT "createdAt", "decidedAt", "decidedBy", "expiresAt", "id", "kind", "note", "payload", "status", "taskId", "title" FROM "Approval";
DROP TABLE "Approval";
ALTER TABLE "new_Approval" RENAME TO "Approval";
CREATE INDEX "Approval_status_createdAt_idx" ON "Approval"("status", "createdAt");
CREATE INDEX "Approval_projectId_status_idx" ON "Approval"("projectId", "status");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

CREATE UNIQUE INDEX "Orchestration_rootTaskId_key" ON "Orchestration"("rootTaskId");

CREATE INDEX "Orchestration_projectId_createdAt_idx" ON "Orchestration"("projectId", "createdAt");

