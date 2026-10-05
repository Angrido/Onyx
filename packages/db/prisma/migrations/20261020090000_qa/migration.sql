ALTER TABLE "Orchestration" ADD COLUMN "qa" BOOLEAN;
ALTER TABLE "Orchestration" ADD COLUMN "resolveConflicts" BOOLEAN;

CREATE TABLE "QaReview" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orchestrationId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL,
    "verdict" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "criteria" JSONB NOT NULL,
    "issues" JSONB NOT NULL,
    "diffTokens" INTEGER NOT NULL,
    "diffTruncated" BOOLEAN NOT NULL DEFAULT false,
    "modelId" TEXT NOT NULL,
    "costUsd" REAL,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "QaReview_orchestrationId_fkey" FOREIGN KEY ("orchestrationId") REFERENCES "Orchestration" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "MergeResolution" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orchestrationId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'PROPOSED',
    "files" JSONB NOT NULL,
    "diff" TEXT NOT NULL,
    "checks" TEXT,
    "checksPassed" BOOLEAN,
    "baseCommit" TEXT NOT NULL,
    "commit" TEXT,
    "modelId" TEXT NOT NULL,
    "costUsd" REAL,
    "message" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" DATETIME,
    CONSTRAINT "MergeResolution_orchestrationId_fkey" FOREIGN KEY ("orchestrationId") REFERENCES "Orchestration" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "QaReview_orchestrationId_taskId_idx" ON "QaReview"("orchestrationId", "taskId");

CREATE INDEX "QaReview_createdAt_idx" ON "QaReview"("createdAt");

CREATE INDEX "MergeResolution_orchestrationId_taskId_idx" ON "MergeResolution"("orchestrationId", "taskId");

CREATE INDEX "MergeResolution_createdAt_idx" ON "MergeResolution"("createdAt");

