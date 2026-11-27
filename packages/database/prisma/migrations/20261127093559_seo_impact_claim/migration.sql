-- ADD COLUMN takes ACCESS EXCLUSIVE on "project_seo_impact_verdict", and the
-- unique index build takes SHARE. While either waits behind an open
-- transaction, later writes of the table wait behind it, so both give up after
-- 5 seconds. The deploy then fails with 55P03. Every statement can run again:
-- run `prisma migrate resolve --rolled-back 20261127093559_seo_impact_claim` on
-- the direct URL (DATABASE_URL_UNPOOLED), then deploy again.
SET lock_timeout = '5s';

-- AlterTable
ALTER TABLE "project_seo_impact_verdict" ADD COLUMN IF NOT EXISTS "claimId" UUID,
ADD COLUMN IF NOT EXISTS "claimedUntil" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "measuredUrl" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "project_seo_impact_verdict_claimId_key" ON "project_seo_impact_verdict"("claimId");

RESET lock_timeout;
