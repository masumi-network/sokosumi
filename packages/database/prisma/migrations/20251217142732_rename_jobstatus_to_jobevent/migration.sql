-- Rename JobStatus to JobEvent
-- This migration renames:
-- 1. Table: jobStatus → jobEvent
-- 2. Foreign key columns: statusId/jobStatusId → eventId
-- 3. All related indexes and constraints

-- Step 1: Drop foreign key constraints that reference jobStatus table
-- (We'll recreate them with new names after renaming)
ALTER TABLE "jobInput" DROP CONSTRAINT IF EXISTS "jobInput_statusId_fkey";
ALTER TABLE "blob" DROP CONSTRAINT IF EXISTS "blob_jobStatusId_fkey";
ALTER TABLE "link" DROP CONSTRAINT IF EXISTS "link_jobStatusId_fkey";
ALTER TABLE "jobStatus" DROP CONSTRAINT IF EXISTS "jobStatus_jobId_fkey";

-- Step 2: Drop indexes that will be renamed
DROP INDEX IF EXISTS "jobStatus_externalId_idx";
DROP INDEX IF EXISTS "jobStatus_jobId_idx";
DROP INDEX IF EXISTS "jobInput_statusId_key";
DROP INDEX IF EXISTS "blob_jobStatusId_origin_idx";
DROP INDEX IF EXISTS "blob_jobStatusId_sourceUrl_key";
DROP INDEX IF EXISTS "link_jobStatusId_idx";
DROP INDEX IF EXISTS "link_jobStatusId_url_key";
DROP INDEX IF EXISTS "jobStatus_jobId_initiated_unique";

-- Step 3: Rename foreign key columns
ALTER TABLE "jobInput" RENAME COLUMN "statusId" TO "eventId";
ALTER TABLE "blob" RENAME COLUMN "jobStatusId" TO "eventId";
ALTER TABLE "link" RENAME COLUMN "jobStatusId" TO "eventId";

-- Step 4: Rename the table
ALTER TABLE "jobStatus" RENAME TO "jobEvent";

-- Step 4.5: Rename the primary key constraint
ALTER TABLE "jobEvent" RENAME CONSTRAINT "jobStatus_pkey" TO "jobEvent_pkey";

-- Step 5: Recreate foreign key constraints with new names
ALTER TABLE "jobEvent" ADD CONSTRAINT "jobEvent_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "jobInput" ADD CONSTRAINT "jobInput_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "jobEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "blob" ADD CONSTRAINT "blob_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "jobEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "link" ADD CONSTRAINT "link_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "jobEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Step 6: Recreate indexes with new names
CREATE INDEX "jobEvent_externalId_idx" ON "jobEvent"("externalId");
CREATE INDEX "jobEvent_jobId_idx" ON "jobEvent"("jobId");
CREATE UNIQUE INDEX "jobInput_eventId_key" ON "jobInput"("eventId");
CREATE INDEX "blob_eventId_origin_idx" ON "blob"("eventId", "origin");
CREATE UNIQUE INDEX "blob_eventId_sourceUrl_key" ON "blob"("eventId", "sourceUrl");
CREATE INDEX "link_eventId_idx" ON "link"("eventId");
CREATE UNIQUE INDEX "link_eventId_url_key" ON "link"("eventId", "url");
CREATE UNIQUE INDEX IF NOT EXISTS "jobEvent_jobId_initiated_unique" ON "jobEvent"("jobId") WHERE status = 'INITIATED';

