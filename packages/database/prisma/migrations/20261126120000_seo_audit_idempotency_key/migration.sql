-- AlterTable
ALTER TABLE "seo_audit" ADD COLUMN     "idempotencyKey" TEXT,
ADD COLUMN     "requestHash" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "seo_audit_workspaceId_idempotencyKey_key" ON "seo_audit"("workspaceId", "idempotencyKey");
