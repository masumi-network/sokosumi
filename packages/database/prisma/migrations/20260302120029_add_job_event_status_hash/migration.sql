-- Add persisted canonical status response hash for sync dedupe
ALTER TABLE "jobEvent"
ADD COLUMN "statusHash" TEXT;

-- Remove deprecated status external ID field from job events
DROP INDEX IF EXISTS "jobEvent_externalId_idx";

ALTER TABLE "jobEvent"
DROP COLUMN IF EXISTS "externalId";

-- Speed up latest-event lookup by job id
CREATE INDEX IF NOT EXISTS "jobEvent_jobId_createdAt_idx"
ON "jobEvent"("jobId", "createdAt" DESC);
