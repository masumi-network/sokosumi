-- Migrate first JobInput record per job to Job table
-- This migration:
-- 1. Migrates data from the first JobInput (by createdAt) per job to Job.input, Job.inputHash, Job.inputSchema
-- 2. Updates blob records to link input blobs to Job instead of JobInput
-- 3. Deletes the migrated JobInput records

-- Step 1: Migrate data from first JobInput to Job
-- For each Job, find the first JobInput (by createdAt ASC) and copy the data
WITH first_job_inputs AS (
  SELECT DISTINCT ON ("jobId")
    id,
    "jobId",
    input,
    "inputHash",
    "inputSchema",
    "createdAt"
  FROM "jobInput"
  ORDER BY "jobId", "createdAt" ASC
)
UPDATE "Job" j
SET 
  "input" = fji.input,
  "inputHash" = fji."inputHash",
  "inputSchema" = COALESCE(
    NULLIF(fji."inputSchema", ''),
    (SELECT js."inputSchema" 
     FROM "jobStatus" js 
     WHERE js."jobId" = j.id 
       AND js."inputSchema" IS NOT NULL 
       AND js."inputSchema" != '' 
     ORDER BY js."createdAt" ASC 
     LIMIT 1),
    '{}'
  )
FROM first_job_inputs fji
WHERE fji."jobId" = j.id
  AND (j."input" IS NULL OR j."input" = '');

-- Step 2: Update blob records to link input blobs to Job instead of JobInput
-- For input blobs linked to the migrated JobInput records, set jobId and clear jobInputId
WITH first_job_inputs AS (
  SELECT DISTINCT ON ("jobId")
    id,
    "jobId"
  FROM "jobInput"
  ORDER BY "jobId", "createdAt" ASC
)
UPDATE "blob" b
SET 
  "jobId" = COALESCE(b."jobId", fji."jobId"),
  "jobInputId" = NULL
FROM first_job_inputs fji
WHERE b."jobInputId" = fji.id
  AND b.origin = 'INPUT'
  AND EXISTS (
    SELECT 1 
    FROM "Job" j 
    WHERE j.id = fji."jobId" 
      AND j."input" IS NOT NULL
      AND j."input" != ''
  );

-- Step 3: Delete the migrated JobInput records
-- Only delete JobInput records that were successfully migrated to Job
WITH first_job_inputs AS (
  SELECT DISTINCT ON ("jobId")
    id,
    "jobId",
    input,
    "inputHash"
  FROM "jobInput"
  ORDER BY "jobId", "createdAt" ASC
)
DELETE FROM "jobInput" ji
WHERE EXISTS (
  SELECT 1 
  FROM first_job_inputs fji
  INNER JOIN "Job" j ON j.id = fji."jobId"
  WHERE ji.id = fji.id
    AND j."input" IS NOT NULL
    AND j."input" = fji.input
    AND (fji."inputHash" IS NULL OR j."inputHash" = fji."inputHash")
);
