-- CMO.xyz: Cuso is a shared Soko Bot of the hire's Project (ADR 0060); this
-- table holds what CMO adds on top. Who hired him is the bot's creator.
CREATE TABLE "cmo_hire" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "workspaceId" UUID NOT NULL,
    "sokoBotId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "businessName" TEXT NOT NULL,
    "websiteUrl" TEXT NOT NULL,
    "goals" TEXT NOT NULL,
    "brandBrain" JSONB,
    "brandBrainUpdatedAt" TIMESTAMP(3),
    "brandBrainApprovedAt" TIMESTAMP(3),
    "brandMedia" JSONB,
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
    "production" JSONB,
    "sitePlatform" TEXT,

    CONSTRAINT "cmo_hire_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "cmo_hire_sokoBotId_key" ON "cmo_hire"("sokoBotId");
CREATE UNIQUE INDEX "cmo_hire_projectId_key" ON "cmo_hire"("projectId");

ALTER TABLE "cmo_hire" ADD CONSTRAINT "cmo_hire_sokoBotId_fkey" FOREIGN KEY ("sokoBotId") REFERENCES "soko_bot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "cmo_hire" ADD CONSTRAINT "cmo_hire_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
