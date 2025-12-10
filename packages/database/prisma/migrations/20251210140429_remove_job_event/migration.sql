-- Remove JobEvent model and finalize schema
-- This migration:
-- 1. Ensures all links have jobStatusId (safety check)
-- 2. Makes jobStatusId required on Link
-- 3. Makes jobEventId optional on Blob and Link
-- 4. Drops foreign key constraints
-- 5. Drops indexes and unique constraints related to jobEventId
-- 6. Drops JobEvent table
-- 7. Removes jobEventId columns from Blob and Link

-- Step 1: Safety check - ensure all links have jobStatusId
-- (This should be a no-op if data migration ran correctly)
UPDATE link
SET "jobStatusId" = (
  SELECT js.id
  FROM "jobStatus" js
  INNER JOIN "jobEvent" je ON js."jobId" = je."jobId"
    AND js."createdAt" = je."createdAt"
    AND js.status = je.status
  WHERE je.id = link."jobEventId"
)
WHERE "jobStatusId" IS NULL
  AND "jobEventId" IS NOT NULL;

-- Step 2: Make jobStatusId required on Link
-- First ensure no NULL values exist
ALTER TABLE "link" 
  ALTER COLUMN "jobStatusId" SET NOT NULL;

-- Step 3: Make jobEventId optional on Blob and Link
ALTER TABLE "blob"
  ALTER COLUMN "jobEventId" DROP NOT NULL;

ALTER TABLE "link"
  ALTER COLUMN "jobEventId" DROP NOT NULL;

-- Step 4: Drop foreign key constraints
ALTER TABLE "blob"
  DROP CONSTRAINT IF EXISTS "blob_jobEventId_fkey";

ALTER TABLE "link"
  DROP CONSTRAINT IF EXISTS "link_jobEventId_fkey";

ALTER TABLE "jobEvent"
  DROP CONSTRAINT IF EXISTS "jobEvent_jobId_fkey";

-- Step 5: Drop indexes and unique constraints
DROP INDEX IF EXISTS "blob_jobEventId_origin_idx";
DROP INDEX IF EXISTS "link_jobEventId_idx";
ALTER TABLE "blob" DROP CONSTRAINT IF EXISTS "blob_jobEventId_sourceUrl_key";
ALTER TABLE "link" DROP CONSTRAINT IF EXISTS "link_jobEventId_url_key";

-- Step 6: Drop JobEvent table
DROP TABLE IF EXISTS "jobEvent";

-- Step 7: Remove jobEventId columns
ALTER TABLE "blob"
  DROP COLUMN IF EXISTS "jobEventId";

ALTER TABLE "link"
  DROP COLUMN IF EXISTS "jobEventId";
