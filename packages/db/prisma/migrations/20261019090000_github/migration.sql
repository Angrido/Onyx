ALTER TABLE "Task" ADD COLUMN "issueLabels" JSONB;
ALTER TABLE "Task" ADD COLUMN "issueNumber" INTEGER;
ALTER TABLE "Task" ADD COLUMN "issueRepo" TEXT;
ALTER TABLE "Task" ADD COLUMN "issueUrl" TEXT;

CREATE TABLE "PullRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "repo" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "url" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "branch" TEXT NOT NULL,
    "baseBranch" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'OPEN',
    "draft" BOOLEAN NOT NULL DEFAULT false,
    "headSha" TEXT,
    "checksState" TEXT NOT NULL DEFAULT 'NONE',
    "checks" JSONB,
    "etags" JSONB,
    "intervalSec" INTEGER NOT NULL DEFAULT 60,
    "checkedAt" DATETIME,
    "nextCheckAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PullRequest_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "ChangelogRelease" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "fromRef" TEXT,
    "toRef" TEXT NOT NULL,
    "markdown" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ChangelogRelease_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "PullRequest_projectId_branch_idx" ON "PullRequest"("projectId", "branch");

CREATE INDEX "PullRequest_state_nextCheckAt_idx" ON "PullRequest"("state", "nextCheckAt");

CREATE UNIQUE INDEX "PullRequest_repo_number_key" ON "PullRequest"("repo", "number");

CREATE INDEX "ChangelogRelease_projectId_createdAt_idx" ON "ChangelogRelease"("projectId", "createdAt");

CREATE INDEX "Task_projectId_issueNumber_idx" ON "Task"("projectId", "issueNumber");

