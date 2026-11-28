-- CREATE TABLE takes no lock on an existing table, and its foreign key takes
-- SHARE ROW EXCLUSIVE on "project_seo_observation". ADD COLUMN takes ACCESS
-- EXCLUSIVE on "project_seo_impact_verdict" for a catalog change only: a
-- nullable column without a default rewrites no row. Adding the pending flag
-- on the observation table also takes ACCESS EXCLUSIVE and uses a constant
-- default, so it does not rewrite existing rows. The unique index build
-- takes SHARE. While one waits behind an open transaction, later writes of that
-- table wait behind it, so each gives up after 5 seconds. The deploy then
-- fails with 55P03. Every statement can run again: run
-- `prisma migrate resolve --rolled-back 20261128134801_seo_audit_recheck` on
-- the direct URL (DATABASE_URL_UNPOOLED), then deploy again.
SET lock_timeout = '5s';

ALTER TABLE "project_seo_observation" ADD COLUMN IF NOT EXISTS "needsAuditRecheck" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE IF NOT EXISTS "project_seo_audit_action_status" (
    "id" UUID NOT NULL,
    "observationId" UUID NOT NULL,
    "actionId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "checkedObservationId" UUID NOT NULL,
    "pairs" JSONB NOT NULL,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_seo_audit_action_status_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "project_seo_audit_action_status_observationId_actionId_key" ON "project_seo_audit_action_status"("observationId", "actionId");

-- AddForeignKey
ALTER TABLE "project_seo_audit_action_status" DROP CONSTRAINT IF EXISTS "project_seo_audit_action_status_observationId_fkey";
ALTER TABLE "project_seo_audit_action_status" ADD CONSTRAINT "project_seo_audit_action_status_observationId_fkey" FOREIGN KEY ("observationId") REFERENCES "project_seo_observation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "project_seo_impact_verdict" ADD COLUMN IF NOT EXISTS "recheckAuditId" UUID;

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "project_seo_impact_verdict_pageUrl_recheckAuditId_key" ON "project_seo_impact_verdict"("pageUrl", "recheckAuditId");

RESET lock_timeout;
