-- ADD COLUMN takes ACCESS EXCLUSIVE on "seo_audit", and the unique index build
-- takes SHARE. While either waits behind an open transaction, later writes of
-- the table wait behind it, so both give up after 5 seconds. The deploy then
-- fails with 55P03. Every statement can run again: run
-- `prisma migrate resolve --rolled-back 20261126120000_seo_audit_idempotency_key`
-- on the direct URL (DATABASE_URL_UNPOOLED), then deploy again.
SET lock_timeout = '5s';

-- AlterTable
ALTER TABLE "seo_audit" ADD COLUMN IF NOT EXISTS "idempotencyKey" TEXT,
ADD COLUMN IF NOT EXISTS "requestHash" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "seo_audit_workspaceId_idempotencyKey_key" ON "seo_audit"("workspaceId", "idempotencyKey");

RESET lock_timeout;
