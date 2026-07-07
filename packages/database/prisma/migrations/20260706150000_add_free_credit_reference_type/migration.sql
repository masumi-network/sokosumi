-- AlterEnum
ALTER TYPE "CreditBucketReferenceType" ADD VALUE 'FREE';

-- AlterTable
ALTER TABLE "credit_bucket" ADD COLUMN "referenceNote" TEXT;
