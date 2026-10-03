ALTER TABLE "Project" ADD COLUMN "indexError" TEXT;
ALTER TABLE "Project" ADD COLUMN "indexStats" JSONB;

PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_AgentRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "agentConfigId" TEXT,
    "routingDecisionId" TEXT,
    "mode" TEXT NOT NULL DEFAULT 'HEADLESS',
    "modelId" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "cliVersion" TEXT,
    "pid" INTEGER,
    "args" JSONB NOT NULL,
    "ignoreHash" TEXT,
    "status" TEXT NOT NULL DEFAULT 'SPAWNING',
    "exitCode" INTEGER,
    "signal" TEXT,
    "resultSubtype" TEXT,
    "isError" BOOLEAN NOT NULL DEFAULT false,
    "numTurns" INTEGER,
    "durationMs" INTEGER,
    "durationApiMs" INTEGER,
    "costUsd" REAL,
    "ctxBaselineTokens" INTEGER,
    "ctxDeliveredTokens" INTEGER,
    "ctxExpansions" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" DATETIME,
    CONSTRAINT "AgentRun_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AgentRun_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AgentRun_agentConfigId_fkey" FOREIGN KEY ("agentConfigId") REFERENCES "AgentConfig" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "AgentRun_routingDecisionId_fkey" FOREIGN KEY ("routingDecisionId") REFERENCES "RoutingDecision" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_AgentRun" ("agentConfigId", "args", "cliVersion", "costUsd", "durationApiMs", "durationMs", "endedAt", "errorMessage", "exitCode", "id", "ignoreHash", "isError", "mode", "modelId", "numTurns", "pid", "prompt", "resultSubtype", "routingDecisionId", "sessionId", "signal", "startedAt", "status", "taskId") SELECT "agentConfigId", "args", "cliVersion", "costUsd", "durationApiMs", "durationMs", "endedAt", "errorMessage", "exitCode", "id", "ignoreHash", "isError", "mode", "modelId", "numTurns", "pid", "prompt", "resultSubtype", "routingDecisionId", "sessionId", "signal", "startedAt", "status", "taskId" FROM "AgentRun";
DROP TABLE "AgentRun";
ALTER TABLE "new_AgentRun" RENAME TO "AgentRun";
CREATE INDEX "AgentRun_taskId_idx" ON "AgentRun"("taskId");
CREATE INDEX "AgentRun_sessionId_idx" ON "AgentRun"("sessionId");
CREATE INDEX "AgentRun_status_idx" ON "AgentRun"("status");
CREATE TABLE "new_FileNode" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "relPath" TEXT NOT NULL,
    "language" TEXT,
    "sizeBytes" INTEGER NOT NULL,
    "contentHash" TEXT NOT NULL,
    "isBinary" BOOLEAN NOT NULL DEFAULT false,
    "isSensitive" BOOLEAN NOT NULL DEFAULT false,
    "hasSyntaxErrors" BOOLEAN NOT NULL DEFAULT false,
    "analyzerVersion" TEXT,
    "rawTokens" INTEGER NOT NULL,
    "l1Tokens" INTEGER,
    "l2Tokens" INTEGER,
    "skeletonL1" TEXT,
    "skeletonL2" TEXT,
    "imports" JSONB,
    "exports" JSONB,
    "domain" TEXT,
    "inDegree" INTEGER NOT NULL DEFAULT 0,
    "outDegree" INTEGER NOT NULL DEFAULT 0,
    "centrality" REAL,
    "blastRadius" INTEGER,
    "inCycle" BOOLEAN NOT NULL DEFAULT false,
    "parsedAt" DATETIME,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "FileNode_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_FileNode" ("centrality", "contentHash", "domain", "id", "inDegree", "isBinary", "language", "l1Tokens", "outDegree", "parsedAt", "projectId", "rawTokens", "relPath", "sizeBytes", "skeletonL1", "skeletonL2", "updatedAt") SELECT "centrality", "contentHash", "domain", "id", "inDegree", "isBinary", "language", "leanTokens", "outDegree", "parsedAt", "projectId", "rawTokens", "relPath", "sizeBytes", "skeletonL1", "skeletonL2", "updatedAt" FROM "FileNode";
DROP TABLE "FileNode";
ALTER TABLE "new_FileNode" RENAME TO "FileNode";
CREATE INDEX "FileNode_projectId_contentHash_idx" ON "FileNode"("projectId", "contentHash");
CREATE UNIQUE INDEX "FileNode_projectId_relPath_key" ON "FileNode"("projectId", "relPath");
CREATE TABLE "new_CodeSymbol" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fileId" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "qualifiedName" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "startOffset" INTEGER NOT NULL,
    "endOffset" INTEGER NOT NULL,
    "startLine" INTEGER NOT NULL,
    "endLine" INTEGER NOT NULL,
    "bodyTokens" INTEGER NOT NULL,
    "exported" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "CodeSymbol_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "FileNode" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_CodeSymbol" ("bodyTokens", "endLine", "endOffset", "exported", "fileId", "handle", "id", "kind", "name", "qualifiedName", "signature", "startLine", "startOffset") SELECT "bodyTokens", "endLine", "endByte", "exported", "fileId", "handle", "id", "kind", "name", "qualifiedName", "signature", "startLine", "startByte" FROM "CodeSymbol";
DROP TABLE "CodeSymbol";
ALTER TABLE "new_CodeSymbol" RENAME TO "CodeSymbol";
CREATE INDEX "CodeSymbol_handle_idx" ON "CodeSymbol"("handle");
CREATE INDEX "CodeSymbol_name_idx" ON "CodeSymbol"("name");
CREATE UNIQUE INDEX "CodeSymbol_fileId_qualifiedName_key" ON "CodeSymbol"("fileId", "qualifiedName");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
