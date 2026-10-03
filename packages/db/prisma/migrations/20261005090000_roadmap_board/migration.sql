-- CreateTable
CREATE TABLE "RoadmapGeneration" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "modelId" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "focus" TEXT,
    "summary" TEXT,
    "error" TEXT,
    "itemCount" INTEGER NOT NULL DEFAULT 0,
    "numTurns" INTEGER,
    "costUsd" REAL,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" DATETIME,
    CONSTRAINT "RoadmapGeneration_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RoadmapItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "generationId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "priority" TEXT NOT NULL DEFAULT 'MEDIUM',
    "effort" TEXT NOT NULL DEFAULT 'M',
    "workspaceName" TEXT,
    "targetPaths" JSONB NOT NULL,
    "rationale" TEXT,
    "status" TEXT NOT NULL DEFAULT 'SUGGESTED',
    "taskId" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "RoadmapItem_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RoadmapItem_generationId_fkey" FOREIGN KEY ("generationId") REFERENCES "RoadmapGeneration" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "RoadmapItem_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "RoadmapGeneration_projectId_startedAt_idx" ON "RoadmapGeneration"("projectId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "RoadmapItem_taskId_key" ON "RoadmapItem"("taskId");

-- CreateIndex
CREATE INDEX "RoadmapItem_projectId_status_idx" ON "RoadmapItem"("projectId", "status");

