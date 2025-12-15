-- Step 1: Migrate input blobs from Job to JobInput (linked to INITIATED status)
-- This must happen BEFORE dropping the columns to ensure data integrity
UPDATE blob
SET 
  "jobInputId" = (
    SELECT ji.id
    FROM "jobInput" ji
    INNER JOIN "jobStatus" js ON ji."statusId" = js.id
    WHERE js."jobId" = blob."jobId"
      AND js.status = 'INITIATED'
      AND blob.origin = 'INPUT'
    LIMIT 1
  ),
  "jobId" = NULL
WHERE "jobId" IS NOT NULL
  AND origin = 'INPUT'
  AND "jobInputId" IS NULL
  AND EXISTS (
    SELECT 1
    FROM "jobInput" ji
    INNER JOIN "jobStatus" js ON ji."statusId" = js.id
    WHERE js."jobId" = blob."jobId"
      AND js.status = 'INITIATED'
  );

-- Step 2: Drop deprecated columns from Job table
ALTER TABLE "Job" 
  DROP COLUMN "input",
  DROP COLUMN "inputSchema",
  DROP COLUMN "inputHash";

-- Step 3: Remove jobId column and related constraints/indexes from blob table
-- Drop the unique constraint on [jobId, sourceUrl]
DROP INDEX IF EXISTS "blob_jobId_sourceUrl_key";

-- Drop the index on [jobId, origin]
DROP INDEX IF EXISTS "blob_jobId_origin_idx";

-- Drop the foreign key constraint
ALTER TABLE "blob" DROP CONSTRAINT IF EXISTS "blob_jobId_fkey";

-- Drop the jobId column
ALTER TABLE "blob" DROP COLUMN "jobId";

