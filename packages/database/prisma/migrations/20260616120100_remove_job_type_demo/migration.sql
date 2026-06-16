-- Delete demo jobs and remove the DEMO JobType enum value.
DELETE FROM "Job" WHERE "jobType" = 'DEMO';

-- Drop check constraints that reference jobType before changing the enum type.
ALTER TABLE "Job" DROP CONSTRAINT IF EXISTS "demo_job_no_blockchain";
ALTER TABLE "Job" DROP CONSTRAINT IF EXISTS "paid_job_blockchain_required";
ALTER TABLE "Job" DROP CONSTRAINT IF EXISTS "free_job_no_blockchain";

CREATE TYPE "JobType_new" AS ENUM ('FREE', 'PAID');
ALTER TABLE "Job"
  ALTER COLUMN "jobType" TYPE "JobType_new"
  USING ("jobType"::text::"JobType_new");
DROP TYPE "JobType";
ALTER TYPE "JobType_new" RENAME TO "JobType";

-- Re-add job type check constraints (demo variant removed).
ALTER TABLE "Job"
ADD CONSTRAINT "paid_job_blockchain_required"
CHECK (
  "jobType" != 'PAID' OR (
    "blockchainIdentifier" IS NOT NULL AND
    "payByTime" IS NOT NULL AND
    "submitResultTime" IS NOT NULL AND
    "unlockTime" IS NOT NULL AND
    "externalDisputeUnlockTime" IS NOT NULL AND
    "sellerVkey" IS NOT NULL AND
    "identifierFromPurchaser" IS NOT NULL AND
    "creditTransactionId" IS NOT NULL
  )
);

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
    "onChainTransactionStatus" IS NULL AND
    "identifierFromPurchaser" IS NULL AND
    "creditTransactionId" IS NULL
  )
);
