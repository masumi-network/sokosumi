-- CMO.xyz: one business run by Cuso, a Soko Bot in its own organization.
CREATE TABLE "cmo_workspace" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
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

    CONSTRAINT "cmo_workspace_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "cmo_workspace_userId_key" ON "cmo_workspace"("userId");
CREATE UNIQUE INDEX "cmo_workspace_organizationId_key" ON "cmo_workspace"("organizationId");
CREATE UNIQUE INDEX "cmo_workspace_workspaceId_key" ON "cmo_workspace"("workspaceId");
CREATE UNIQUE INDEX "cmo_workspace_sokoBotId_key" ON "cmo_workspace"("sokoBotId");

ALTER TABLE "cmo_workspace" ADD CONSTRAINT "cmo_workspace_sokoBotId_fkey" FOREIGN KEY ("sokoBotId") REFERENCES "soko_bot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
