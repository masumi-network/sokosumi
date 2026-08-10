-- CreateEnum
CREATE TYPE "CoworkerWorkspaceAccessStatus" AS ENUM ('PENDING', 'GRANTED', 'DENIED', 'REVOKED');

-- CreateTable
CREATE TABLE "coworker_workspace_access" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "coworkerId" TEXT NOT NULL,
    "workspaceId" UUID NOT NULL,
    "status" "CoworkerWorkspaceAccessStatus" NOT NULL DEFAULT 'PENDING',
    "requestedByUserId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,

    CONSTRAINT "coworker_workspace_access_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "coworker_workspace_access_workspaceId_status_idx" ON "coworker_workspace_access"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "coworker_workspace_access_coworkerId_status_idx" ON "coworker_workspace_access"("coworkerId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "coworker_workspace_access_coworkerId_workspaceId_key" ON "coworker_workspace_access"("coworkerId", "workspaceId");

-- AddForeignKey
ALTER TABLE "coworker_workspace_access" ADD CONSTRAINT "coworker_workspace_access_coworkerId_fkey" FOREIGN KEY ("coworkerId") REFERENCES "coworker"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coworker_workspace_access" ADD CONSTRAINT "coworker_workspace_access_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coworker_workspace_access" ADD CONSTRAINT "coworker_workspace_access_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coworker_workspace_access" ADD CONSTRAINT "coworker_workspace_access_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
