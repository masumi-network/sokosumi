-- AlterEnum
ALTER TYPE "CreditBucketReferenceType" ADD VALUE 'SUPPORT';

-- AlterTable
ALTER TABLE "credit_bucket" ADD COLUMN "referenceNote" TEXT;
