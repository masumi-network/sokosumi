-- CMO.xyz: Cuso is a Soko Bot pinned to one Project in the Workspace the
-- person chose (ADR 0053), beside any personal assistant there.
ALTER TABLE "soko_bot" ADD COLUMN "projectId" UUID;
ALTER TABLE "soko_bot" ADD CONSTRAINT "soko_bot_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- One live personal bot per user and workspace; project bots sit beside it.
DROP INDEX IF EXISTS "soko_bot_user_workspace_live_key";
CREATE UNIQUE INDEX "soko_bot_user_workspace_live_key" ON "soko_bot"("userId", "workspaceId") WHERE "deletedAt" IS NULL AND "projectId" IS NULL;
-- One live bot per Project.
CREATE UNIQUE INDEX "soko_bot_project_live_key" ON "soko_bot"("projectId") WHERE "deletedAt" IS NULL AND "projectId" IS NOT NULL;

CREATE TABLE "cmo_workspace" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,
    "workspaceId" UUID NOT NULL,
    "sokoBotId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "businessName" TEXT NOT NULL,
    "websiteUrl" TEXT NOT NULL,
    "goals" TEXT NOT NULL,
    "brandBrain" JSONB,
    "brandBrainUpdatedAt" TIMESTAMP(3),
    "strategy" JSONB,
    "strategyUpdatedAt" TIMESTAMP(3),
    "strategyApprovedAt" TIMESTAMP(3),
    "strategyHistory" JSONB,
    "updates" JSONB,
    "brandVisual" JSONB,
    "mockPlan" TEXT,
    "mockPlanActivatedAt" TIMESTAMP(3),
    "accountsDoneAt" TIMESTAMP(3),
    "onboardedAt" TIMESTAMP(3),

    CONSTRAINT "cmo_workspace_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "cmo_workspace_userId_key" ON "cmo_workspace"("userId");
CREATE UNIQUE INDEX "cmo_workspace_sokoBotId_key" ON "cmo_workspace"("sokoBotId");
CREATE UNIQUE INDEX "cmo_workspace_projectId_key" ON "cmo_workspace"("projectId");

ALTER TABLE "cmo_workspace" ADD CONSTRAINT "cmo_workspace_sokoBotId_fkey" FOREIGN KEY ("sokoBotId") REFERENCES "soko_bot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "cmo_workspace" ADD CONSTRAINT "cmo_workspace_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
