-- Project credits (ADR 0067, SOKD-178). Nullable: null is the Organization
-- credit pool. The owner XOR CHECK credit_bucket_owner_xor_check is untouched.

-- AlterTable
ALTER TABLE "credit_bucket" ADD COLUMN "projectId" UUID;

-- CreateIndex
CREATE INDEX "credit_bucket_projectId_idx" ON "credit_bucket"("projectId");

-- AddForeignKey
ALTER TABLE "credit_bucket" ADD CONSTRAINT "credit_bucket_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
