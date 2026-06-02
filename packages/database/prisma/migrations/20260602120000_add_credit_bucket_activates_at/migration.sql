-- AlterTable
ALTER TABLE "credit_bucket" ADD COLUMN "activatesAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "credit_bucket_activatesAt_idx" ON "credit_bucket"("activatesAt");
