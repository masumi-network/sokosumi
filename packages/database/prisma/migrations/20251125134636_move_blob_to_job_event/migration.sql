-- Move Blob table connection from Job to JobEvent
-- This migration:
-- 1. Adds jobEventId column to blob table (nullable initially)
-- 2. Migrates existing blobs to appropriate JobEvents (event with result, or latest event)
-- 3. Makes jobEventId NOT NULL
-- 4. Removes jobId column and foreign key
-- 5. Adds foreign key constraint for jobEventId
-- 6. Updates indexes

-- Step 1: Add jobEventId column (nullable initially)
ALTER TABLE "blob" ADD COLUMN "jobEventId" TEXT;

-- Step 2: Migrate existing blobs to JobEvents
-- For each blob, find the JobEvent with a result for its job
-- If no event with result exists, use the latest JobEvent for that job
UPDATE "blob" b
SET "jobEventId" = (
  SELECT je.id
  FROM "jobEvent" je
  WHERE je."jobId" = b."jobId"
    AND je.result IS NOT NULL
  ORDER BY je."createdAt" DESC
  LIMIT 1
)
WHERE EXISTS (
  SELECT 1
  FROM "jobEvent" je
  WHERE je."jobId" = b."jobId"
    AND je.result IS NOT NULL
);

-- For blobs where no event with result exists, use the latest JobEvent
UPDATE "blob" b
SET "jobEventId" = (
  SELECT je.id
  FROM "jobEvent" je
  WHERE je."jobId" = b."jobId"
  ORDER BY je."createdAt" DESC
  LIMIT 1
)
WHERE b."jobEventId" IS NULL;

-- Step 3: Make jobEventId NOT NULL
ALTER TABLE "blob" ALTER COLUMN "jobEventId" SET NOT NULL;

-- Step 4: Remove old foreign key constraint and jobId column
ALTER TABLE "blob" DROP CONSTRAINT IF EXISTS "blob_jobId_fkey";
ALTER TABLE "blob" DROP COLUMN "jobId";

-- Step 5: Add foreign key constraint for jobEventId
ALTER TABLE "blob" ADD CONSTRAINT "blob_jobEventId_fkey" FOREIGN KEY ("jobEventId") REFERENCES "jobEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Step 6: Update indexes
-- Remove old indexes
DROP INDEX IF EXISTS "blob_jobId_origin_idx";
DROP INDEX IF EXISTS "blob_jobId_sourceUrl_idx";

-- Add new indexes
CREATE INDEX "blob_jobEventId_origin_idx" ON "blob"("jobEventId", "origin");
CREATE INDEX "blob_jobEventId_sourceUrl_idx" ON "blob"("jobEventId", "sourceUrl");

