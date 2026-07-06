-- AlterEnum
ALTER TYPE "CreditBucketReferenceType" ADD VALUE 'SIGNUP_BONUS';

-- AlterTable
ALTER TABLE "credit_bucket" ADD COLUMN "referenceNote" TEXT;
