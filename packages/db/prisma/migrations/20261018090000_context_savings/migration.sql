ALTER TABLE "AgentRun" ADD COLUMN "batchSize" INTEGER;

ALTER TABLE "Orchestration" ADD COLUMN "plannerExplorer" BOOLEAN;
ALTER TABLE "Orchestration" ADD COLUMN "plannerModelCostUsd" REAL;

ALTER TABLE "Session" ADD COLUMN "concise" BOOLEAN;

ALTER TABLE "Task" ADD COLUMN "batchRunId" TEXT;

