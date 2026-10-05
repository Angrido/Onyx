CREATE TABLE "CommandGrant" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "rule" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "taskId" TEXT,
    "agentConfigId" TEXT,
    "command" TEXT,
    "expiresAt" DATETIME,
    "createdBy" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CommandGrant_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CommandGrant_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CommandGrant_agentConfigId_fkey" FOREIGN KEY ("agentConfigId") REFERENCES "AgentConfig" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "CommandGrant_projectId_idx" ON "CommandGrant"("projectId");

CREATE INDEX "CommandGrant_taskId_idx" ON "CommandGrant"("taskId");

