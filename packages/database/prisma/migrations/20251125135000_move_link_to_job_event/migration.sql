-- Move Link table connection from Job to JobEvent
-- This migration:
-- 1. Adds jobEventId column to link table (nullable initially)
-- 2. Migrates existing links to appropriate JobEvents (event with result, or latest event)
-- 3. Makes jobEventId NOT NULL
-- 4. Removes jobId column and foreign key
-- 5. Adds foreign key constraint for jobEventId
-- 6. Updates indexes

-- Step 1: Add jobEventId column (nullable initially)
ALTER TABLE "link" ADD COLUMN "jobEventId" TEXT;

-- Step 2: Migrate existing links to JobEvents
-- For each link, find the JobEvent with a result for its job
-- If no event with result exists, use the latest JobEvent for that job
UPDATE "link" l
SET "jobEventId" = (
  SELECT je.id
  FROM "jobEvent" je
  WHERE je."jobId" = l."jobId"
    AND je.result IS NOT NULL
  ORDER BY je."createdAt" DESC
  LIMIT 1
)
WHERE EXISTS (
  SELECT 1
  FROM "jobEvent" je
  WHERE je."jobId" = l."jobId"
    AND je.result IS NOT NULL
);

-- For links where no event with result exists, use the latest JobEvent
UPDATE "link" l
SET "jobEventId" = (
  SELECT je.id
  FROM "jobEvent" je
  WHERE je."jobId" = l."jobId"
  ORDER BY je."createdAt" DESC
  LIMIT 1
)
WHERE l."jobEventId" IS NULL;

-- Step 3: Make jobEventId NOT NULL
ALTER TABLE "link" ALTER COLUMN "jobEventId" SET NOT NULL;

-- Step 4: Remove old foreign key constraint and jobId column
ALTER TABLE "link" DROP CONSTRAINT IF EXISTS "link_jobId_fkey";
DROP INDEX IF EXISTS "link_jobId_url_key";
DROP INDEX IF EXISTS "link_jobId_idx";
ALTER TABLE "link" DROP COLUMN "jobId";

-- Step 5: Add foreign key constraint for jobEventId
ALTER TABLE "link" ADD CONSTRAINT "link_jobEventId_fkey" FOREIGN KEY ("jobEventId") REFERENCES "jobEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Step 6: Update indexes
-- Add new unique constraint
CREATE UNIQUE INDEX "link_jobEventId_url_key" ON "link"("jobEventId", "url");
-- Add new index
CREATE INDEX "link_jobEventId_idx" ON "link"("jobEventId");

