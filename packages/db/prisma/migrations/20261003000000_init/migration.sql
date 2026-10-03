CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastLoginAt" DATETIME
);

CREATE TABLE "UserSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userAgent" TEXT,
    "ip" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL,
    CONSTRAINT "UserSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "Project" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "rootPath" TEXT NOT NULL,
    "gitRemote" TEXT,
    "defaultBranch" TEXT NOT NULL DEFAULT 'main',
    "indexedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE TABLE "Workspace" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "pathGlobs" JSONB NOT NULL,
    "writeFenceGlobs" JSONB NOT NULL,
    "primer" TEXT,
    "resetStrategy" TEXT NOT NULL DEFAULT 'HANDOFF',
    "maxSessionTokens" INTEGER NOT NULL DEFAULT 150000,
    "testRunner" TEXT,
    "testCommand" TEXT,
    "color" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "agentConfigId" TEXT,
    "ignoreProfileId" TEXT,
    "activeSessionId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Workspace_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Workspace_agentConfigId_fkey" FOREIGN KEY ("agentConfigId") REFERENCES "AgentConfig" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Workspace_ignoreProfileId_fkey" FOREIGN KEY ("ignoreProfileId") REFERENCES "IgnoreProfile" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Workspace_activeSessionId_fkey" FOREIGN KEY ("activeSessionId") REFERENCES "Session" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "ModelProfile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "displayName" TEXT NOT NULL,
    "alias" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "contextWindow" INTEGER NOT NULL,
    "inputUsdPerMTok" REAL NOT NULL,
    "outputUsdPerMTok" REAL NOT NULL,
    "cacheReadUsdPerMTok" REAL,
    "cacheWriteUsdPerMTok" REAL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" DATETIME NOT NULL
);

CREATE TABLE "AgentConfig" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "tier" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "fallbackModelIds" JSONB,
    "effort" TEXT,
    "permissionMode" TEXT NOT NULL DEFAULT 'acceptEdits',
    "allowedTools" JSONB NOT NULL,
    "disallowedTools" JSONB NOT NULL,
    "maxTurns" INTEGER NOT NULL DEFAULT 40,
    "timeoutSec" INTEGER NOT NULL DEFAULT 1800,
    "idleTimeoutSec" INTEGER NOT NULL DEFAULT 300,
    "appendSystemPrompt" TEXT,
    "subagents" JSONB,
    "partialMessages" BOOLEAN NOT NULL DEFAULT false,
    "isBuiltin" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE TABLE "RoutingRule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT,
    "name" TEXT NOT NULL,
    "priority" INTEGER NOT NULL,
    "matcher" JSONB NOT NULL,
    "targetTier" TEXT NOT NULL,
    "modelId" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "RoutingRule_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "RoutingDecision" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskId" TEXT NOT NULL,
    "ruleId" TEXT,
    "strategy" TEXT NOT NULL,
    "features" JSONB NOT NULL,
    "score" REAL,
    "confidence" REAL,
    "tier" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "previousId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RoutingDecision_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RoutingDecision_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "RoutingRule" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "RoutingDecision_previousId_fkey" FOREIGN KEY ("previousId") REFERENCES "RoutingDecision" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "Task" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "workspaceId" TEXT,
    "parentTaskId" TEXT,
    "title" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "targetPaths" JSONB,
    "acceptance" JSONB,
    "modelOverride" TEXT,
    "worktreePath" TEXT,
    "branchName" TEXT,
    "budgetUsd" REAL,
    "resultSummary" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Task_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Task_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Task_parentTaskId_fkey" FOREIGN KEY ("parentTaskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "TaskDependency" (
    "taskId" TEXT NOT NULL,
    "dependsOnId" TEXT NOT NULL,

    PRIMARY KEY ("taskId", "dependsOnId"),
    CONSTRAINT "TaskDependency_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TaskDependency_dependsOnId_fkey" FOREIGN KEY ("dependsOnId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "claudeSessionId" TEXT,
    "modelId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "endReason" TEXT,
    "previousId" TEXT,
    "handoffNote" TEXT,
    "primerHash" TEXT,
    "turns" INTEGER NOT NULL DEFAULT 0,
    "contextTokens" INTEGER NOT NULL DEFAULT 0,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastActivityAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" DATETIME,
    CONSTRAINT "Session_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Session_previousId_fkey" FOREIGN KEY ("previousId") REFERENCES "Session" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "AgentRun" (
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
    "errorMessage" TEXT,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" DATETIME,
    CONSTRAINT "AgentRun_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AgentRun_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AgentRun_agentConfigId_fkey" FOREIGN KEY ("agentConfigId") REFERENCES "AgentConfig" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "AgentRun_routingDecisionId_fkey" FOREIGN KEY ("routingDecisionId") REFERENCES "RoutingDecision" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "AgentEvent" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "runId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "subtype" TEXT,
    "payload" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AgentEvent_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "TokenLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runId" TEXT,
    "sessionId" TEXT,
    "modelId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "purpose" TEXT,
    "inputTokens" INTEGER NOT NULL,
    "outputTokens" INTEGER NOT NULL,
    "cacheCreationTokens" INTEGER NOT NULL DEFAULT 0,
    "cacheReadTokens" INTEGER NOT NULL DEFAULT 0,
    "costUsd" REAL,
    "ctxBaselineTokens" INTEGER,
    "ctxDeliveredTokens" INTEGER,
    "counterfactualUsd" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TokenLog_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TokenLog_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "IgnoreProfile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "preset" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "compiledHash" TEXT,
    "compiledAt" DATETIME,
    "estimatedSavedTokens" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "IgnoreProfile_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "IgnoreRule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "profileId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "pattern" TEXT NOT NULL,
    "action" TEXT NOT NULL DEFAULT 'EXCLUDE',
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "reason" TEXT,
    "tokenImpact" INTEGER,
    CONSTRAINT "IgnoreRule_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "IgnoreProfile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "FileNode" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "relPath" TEXT NOT NULL,
    "language" TEXT,
    "sizeBytes" INTEGER NOT NULL,
    "contentHash" TEXT NOT NULL,
    "isBinary" BOOLEAN NOT NULL DEFAULT false,
    "rawTokens" INTEGER NOT NULL,
    "leanTokens" INTEGER,
    "skeletonL1" TEXT,
    "skeletonL2" TEXT,
    "domain" TEXT,
    "inDegree" INTEGER NOT NULL DEFAULT 0,
    "outDegree" INTEGER NOT NULL DEFAULT 0,
    "centrality" REAL,
    "parsedAt" DATETIME,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "FileNode_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "CodeSymbol" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fileId" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "qualifiedName" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "startByte" INTEGER NOT NULL,
    "endByte" INTEGER NOT NULL,
    "startLine" INTEGER NOT NULL,
    "endLine" INTEGER NOT NULL,
    "bodyTokens" INTEGER NOT NULL,
    "exported" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "CodeSymbol_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "FileNode" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "DependencyEdge" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "fromId" TEXT NOT NULL,
    "toId" TEXT,
    "external" TEXT,
    "kind" TEXT NOT NULL,
    "specifier" TEXT NOT NULL,
    "symbols" JSONB,
    CONSTRAINT "DependencyEdge_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DependencyEdge_fromId_fkey" FOREIGN KEY ("fromId") REFERENCES "FileNode" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DependencyEdge_toId_fkey" FOREIGN KEY ("toId") REFERENCES "FileNode" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "TddLoop" (
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
    "violations" INTEGER NOT NULL DEFAULT 0,
    "startedAt" DATETIME,
    "endedAt" DATETIME,
    "greenAt" DATETIME,
    CONSTRAINT "TddLoop_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TddLoop_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "TddIteration" (
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TddIteration_loopId_fkey" FOREIGN KEY ("loopId") REFERENCES "TddLoop" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TddIteration_agentRunId_fkey" FOREIGN KEY ("agentRunId") REFERENCES "AgentRun" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "Budget" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scope" TEXT NOT NULL,
    "projectId" TEXT,
    "period" TEXT NOT NULL,
    "softUsd" REAL,
    "hardUsd" REAL NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Budget_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "Approval" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskId" TEXT,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "title" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "decidedBy" TEXT,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" DATETIME,
    "expiresAt" DATETIME,
    CONSTRAINT "Approval_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "AppSetting" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" JSONB NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

CREATE TABLE "AuditLog" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "actor" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "target" TEXT,
    "meta" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

CREATE UNIQUE INDEX "UserSession_tokenHash_key" ON "UserSession"("tokenHash");

CREATE INDEX "UserSession_expiresAt_idx" ON "UserSession"("expiresAt");

CREATE UNIQUE INDEX "Project_name_key" ON "Project"("name");

CREATE UNIQUE INDEX "Project_rootPath_key" ON "Project"("rootPath");

CREATE UNIQUE INDEX "Workspace_activeSessionId_key" ON "Workspace"("activeSessionId");

CREATE UNIQUE INDEX "Workspace_projectId_name_key" ON "Workspace"("projectId", "name");

CREATE UNIQUE INDEX "AgentConfig_name_key" ON "AgentConfig"("name");

CREATE INDEX "RoutingRule_projectId_enabled_priority_idx" ON "RoutingRule"("projectId", "enabled", "priority");

CREATE UNIQUE INDEX "RoutingDecision_previousId_key" ON "RoutingDecision"("previousId");

CREATE INDEX "RoutingDecision_taskId_createdAt_idx" ON "RoutingDecision"("taskId", "createdAt");

CREATE INDEX "Task_projectId_status_idx" ON "Task"("projectId", "status");

CREATE INDEX "Task_parentTaskId_idx" ON "Task"("parentTaskId");

CREATE UNIQUE INDEX "Session_claudeSessionId_key" ON "Session"("claudeSessionId");

CREATE UNIQUE INDEX "Session_previousId_key" ON "Session"("previousId");

CREATE INDEX "Session_workspaceId_status_idx" ON "Session"("workspaceId", "status");

CREATE INDEX "AgentRun_taskId_idx" ON "AgentRun"("taskId");

CREATE INDEX "AgentRun_sessionId_idx" ON "AgentRun"("sessionId");

CREATE INDEX "AgentRun_status_idx" ON "AgentRun"("status");

CREATE INDEX "AgentEvent_createdAt_idx" ON "AgentEvent"("createdAt");

CREATE UNIQUE INDEX "AgentEvent_runId_seq_key" ON "AgentEvent"("runId", "seq");

CREATE INDEX "TokenLog_runId_idx" ON "TokenLog"("runId");

CREATE INDEX "TokenLog_sessionId_idx" ON "TokenLog"("sessionId");

CREATE INDEX "TokenLog_modelId_createdAt_idx" ON "TokenLog"("modelId", "createdAt");

CREATE INDEX "TokenLog_scope_createdAt_idx" ON "TokenLog"("scope", "createdAt");

CREATE UNIQUE INDEX "IgnoreProfile_projectId_name_key" ON "IgnoreProfile"("projectId", "name");

CREATE UNIQUE INDEX "IgnoreRule_profileId_position_key" ON "IgnoreRule"("profileId", "position");

CREATE INDEX "FileNode_projectId_contentHash_idx" ON "FileNode"("projectId", "contentHash");

CREATE UNIQUE INDEX "FileNode_projectId_relPath_key" ON "FileNode"("projectId", "relPath");

CREATE INDEX "CodeSymbol_handle_idx" ON "CodeSymbol"("handle");

CREATE INDEX "CodeSymbol_name_idx" ON "CodeSymbol"("name");

CREATE UNIQUE INDEX "CodeSymbol_fileId_qualifiedName_key" ON "CodeSymbol"("fileId", "qualifiedName");

CREATE INDEX "DependencyEdge_projectId_idx" ON "DependencyEdge"("projectId");

CREATE INDEX "DependencyEdge_fromId_idx" ON "DependencyEdge"("fromId");

CREATE INDEX "DependencyEdge_toId_idx" ON "DependencyEdge"("toId");

CREATE INDEX "TddLoop_taskId_idx" ON "TddLoop"("taskId");

CREATE UNIQUE INDEX "TddIteration_agentRunId_key" ON "TddIteration"("agentRunId");

CREATE UNIQUE INDEX "TddIteration_loopId_index_key" ON "TddIteration"("loopId", "index");

CREATE INDEX "Budget_scope_enabled_idx" ON "Budget"("scope", "enabled");

CREATE INDEX "Approval_status_createdAt_idx" ON "Approval"("status", "createdAt");

CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");
