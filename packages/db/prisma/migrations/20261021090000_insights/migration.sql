CREATE TABLE "Insight" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "intent" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "sources" JSONB NOT NULL,
    "modelId" TEXT,
    "costUsd" REAL,
    "tokens" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Insight_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "IdeationRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "files" INTEGER NOT NULL DEFAULT 0,
    "audit" TEXT,
    "projectTokens" INTEGER,
    "snippetTokens" INTEGER,
    "modelTokens" INTEGER,
    "modelCostUsd" REAL,
    "reviewedAt" DATETIME,
    "message" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" DATETIME,
    CONSTRAINT "IdeationRun_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "IdeationFinding" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "rule" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "file" TEXT,
    "line" INTEGER,
    "excerpt" TEXT,
    "explanation" TEXT NOT NULL,
    "confidence" REAL NOT NULL,
    "source" TEXT NOT NULL,
    "verdict" TEXT,
    "fix" TEXT,
    "state" TEXT NOT NULL DEFAULT 'OPEN',
    "taskId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "IdeationFinding_runId_fkey" FOREIGN KEY ("runId") REFERENCES "IdeationRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "Insight_projectId_createdAt_idx" ON "Insight"("projectId", "createdAt");

CREATE INDEX "Insight_createdAt_idx" ON "Insight"("createdAt");

CREATE INDEX "IdeationRun_projectId_createdAt_idx" ON "IdeationRun"("projectId", "createdAt");

CREATE INDEX "IdeationFinding_runId_idx" ON "IdeationFinding"("runId");

CREATE INDEX "IdeationFinding_projectId_fingerprint_idx" ON "IdeationFinding"("projectId", "fingerprint");

