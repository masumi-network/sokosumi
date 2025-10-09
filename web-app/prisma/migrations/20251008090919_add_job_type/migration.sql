/*
  Warnings:

  - Added the required column `jobType` to the `Job` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "JobType" AS ENUM ('FREE', 'PAID', 'DEMO');

-- AlterTable
ALTER TABLE "Job" 
ADD COLUMN     "jobType" "JobType",
ALTER COLUMN "blockchainIdentifier" DROP NOT NULL,
ALTER COLUMN "submitResultTime" DROP NOT NULL,
ALTER COLUMN "unlockTime" DROP NOT NULL,
ALTER COLUMN "externalDisputeUnlockTime" DROP NOT NULL,
ALTER COLUMN "sellerVkey" DROP NOT NULL,
ALTER COLUMN "payByTime" DROP NOT NULL;

-- Backfill existing rows as PAID jobs
UPDATE "Job" SET "jobType" = 'PAID' WHERE "jobType" IS NULL;

-- Migrate existing isDemo=true jobs to JobType.DEMO
UPDATE "Job"
SET "jobType" = 'DEMO'
WHERE "isDemo" = true;

-- Ensure jobType is required moving forward
ALTER TABLE "Job"
ALTER COLUMN "jobType" SET NOT NULL;

-- Add constraint: PAID jobs require blockchain fields
ALTER TABLE "Job"
ADD CONSTRAINT "paid_job_blockchain_required"
CHECK (
  "jobType" != 'PAID' OR (
    "blockchainIdentifier" IS NOT NULL AND
    "payByTime" IS NOT NULL AND
    "submitResultTime" IS NOT NULL AND
    "unlockTime" IS NOT NULL AND
    "externalDisputeUnlockTime" IS NOT NULL AND
    "sellerVkey" IS NOT NULL
  )
);

-- Add constraint: FREE jobs must not have blockchain fields
ALTER TABLE "Job"
ADD CONSTRAINT "free_job_no_blockchain"
CHECK (
  "jobType" != 'FREE' OR (
    "blockchainIdentifier" IS NULL AND
    "payByTime" IS NULL AND
    "submitResultTime" IS NULL AND
    "unlockTime" IS NULL AND
    "externalDisputeUnlockTime" IS NULL AND
    "sellerVkey" IS NULL AND
    "purchaseId" IS NULL AND
    "inputHash" IS NULL AND
    "resultHash" IS NULL AND
    "onChainStatus" IS NULL AND
    "onChainTransactionHash" IS NULL AND
    "onChainTransactionStatus" IS NULL
  )
);

-- Add constraint: FREE jobs must not have blockchain fields
ALTER TABLE "Job"
ADD CONSTRAINT "demo_job_no_blockchain"
CHECK (
  "jobType" != 'DEMO' OR (
    "blockchainIdentifier" IS NULL AND
    "payByTime" IS NULL AND
    "submitResultTime" IS NULL AND
    "unlockTime" IS NULL AND
    "externalDisputeUnlockTime" IS NULL AND
    "sellerVkey" IS NULL AND
    "purchaseId" IS NULL AND
    "inputHash" IS NULL AND
    "resultHash" IS NULL AND
    "onChainStatus" IS NULL AND
    "onChainTransactionHash" IS NULL AND
    "onChainTransactionStatus" IS NULL
  )
);
