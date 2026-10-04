ALTER TABLE "AgentRun" ADD COLUMN "contextArm" TEXT;
ALTER TABLE "AgentRun" ADD COLUMN "ctxReadFiles" INTEGER;
ALTER TABLE "AgentRun" ADD COLUMN "ctxRereadFiles" INTEGER;
ALTER TABLE "AgentRun" ADD COLUMN "ctxRereadTokens" INTEGER;
ALTER TABLE "AgentRun" ADD COLUMN "ctxMissedFiles" INTEGER;
ALTER TABLE "AgentRun" ADD COLUMN "ctxRereadPaths" JSONB;

CREATE INDEX "AgentRun_contextArm_startedAt_idx" ON "AgentRun"("contextArm", "startedAt");
