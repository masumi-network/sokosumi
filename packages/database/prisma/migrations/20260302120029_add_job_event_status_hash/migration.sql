-- Add persisted canonical status response hash for sync dedupe
ALTER TABLE "jobEvent"
ADD COLUMN "statusHash" TEXT;

-- Remove deprecated status external ID field from job events
DROP INDEX IF EXISTS "jobEvent_externalId_idx";

ALTER TABLE "jobEvent"
DROP COLUMN IF EXISTS "externalId";
