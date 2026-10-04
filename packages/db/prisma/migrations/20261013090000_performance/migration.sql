ALTER TABLE "AgentEvent" ADD COLUMN "items" JSONB;

CREATE INDEX "AgentRun_endedAt_idx" ON "AgentRun"("endedAt");

CREATE INDEX "AgentRun_status_startedAt_idx" ON "AgentRun"("status", "startedAt");

CREATE INDEX "AgentRun_startedAt_idx" ON "AgentRun"("startedAt");

CREATE INDEX "Approval_taskId_idx" ON "Approval"("taskId");

CREATE INDEX "Approval_createdAt_idx" ON "Approval"("createdAt");

CREATE INDEX "RoutingDecision_createdAt_idx" ON "RoutingDecision"("createdAt");

CREATE INDEX "Task_projectId_updatedAt_idx" ON "Task"("projectId", "updatedAt");

CREATE INDEX "Task_updatedAt_idx" ON "Task"("updatedAt");

CREATE INDEX "Task_workspaceId_idx" ON "Task"("workspaceId");

CREATE INDEX "TokenLog_createdAt_idx" ON "TokenLog"("createdAt");


CREATE INDEX "TokenLog_runId_scope_idx" ON "TokenLog"("runId", "scope");
