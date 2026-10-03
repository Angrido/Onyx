ALTER TABLE "AgentRun" ADD COLUMN "changedFiles" JSONB;

ALTER TABLE "Session" ADD COLUMN "handoffTokens" INTEGER;

UPDATE "RoutingRule"
SET "matcher" = '{"taskKinds":["ARCHITECTURE"]}'
WHERE "projectId" IS NULL AND "name" = 'architecture-work';
