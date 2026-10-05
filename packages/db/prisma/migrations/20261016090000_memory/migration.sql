ALTER TABLE "AgentRun" ADD COLUMN "memoryArm" TEXT;

ALTER TABLE "Session" ADD COLUMN "memory" JSONB;
ALTER TABLE "Session" ADD COLUMN "memoryArm" TEXT;

CREATE TABLE "ProjectFact" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "detail" TEXT,
    "text" TEXT,
    "status" TEXT NOT NULL DEFAULT 'CANDIDATE',
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "evidence" INTEGER NOT NULL DEFAULT 1,
    "sourceRunId" TEXT,
    "sourcePath" TEXT,
    "firstSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProjectFact_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "ProjectFact_projectId_status_idx" ON "ProjectFact"("projectId", "status");

CREATE UNIQUE INDEX "ProjectFact_projectId_kind_key_key" ON "ProjectFact"("projectId", "kind", "key");

