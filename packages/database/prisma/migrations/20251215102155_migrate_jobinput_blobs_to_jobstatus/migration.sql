-- Step 1: Migrate blobs from JobInput to associated JobStatus
-- For each blob linked to a JobInput, link it to the JobStatus that the JobInput belongs to
UPDATE blob
SET 
  "jobStatusId" = (
    SELECT ji."statusId"
    FROM "jobInput" ji
    WHERE ji.id = blob."jobInputId"
  ),
  "jobInputId" = NULL
WHERE "jobInputId" IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM "jobInput" ji
    WHERE ji.id = blob."jobInputId"
      AND ji."statusId" IS NOT NULL
  );

-- Step 2: Drop indexes related to jobInputId
DROP INDEX IF EXISTS "blob_jobInputId_origin_idx";
DROP INDEX IF EXISTS "blob_jobInputId_sourceUrl_key";

-- Step 3: Drop foreign key constraint
ALTER TABLE "blob" DROP CONSTRAINT IF EXISTS "blob_jobInputId_fkey";

-- Step 4: Drop jobInputId column
ALTER TABLE "blob" DROP COLUMN "jobInputId";

