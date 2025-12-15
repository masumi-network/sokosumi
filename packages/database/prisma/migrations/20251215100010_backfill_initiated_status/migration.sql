-- Backfill INITIATED jobStatus and jobInput for all existing jobs
-- This migration:
-- 1. Creates an INITIATED jobStatus for each Job that doesn't already have one
-- 2. Creates a jobInput linked to each new INITIATED jobStatus with data from Job.input
-- 3. Sets createdAt for both jobStatus and jobInput to match Job.createdAt
--
-- Note: We use gen_random_uuid()::text for ID generation instead of Prisma's cuid()
-- because CUIDs cannot be generated natively in PostgreSQL SQL. UUIDs are standard,
-- cryptographically secure, and work well for migration-generated records.

-- Step 1: Insert INITIATED jobStatus for all jobs missing one
WITH jobs_missing_initiated AS (
  SELECT j.id, j."createdAt", j."inputSchema"
  FROM "Job" j
  WHERE NOT EXISTS (
    SELECT 1
    FROM "jobStatus" js
    WHERE js."jobId" = j.id
      AND js.status = 'INITIATED'
  )
),
inserted_statuses AS (
  INSERT INTO "jobStatus" (
    id,
    "createdAt",
    "updatedAt",
    "jobId",
    status,
    "inputSchema"
  )
  SELECT
    gen_random_uuid()::text,
    jmi."createdAt",
    jmi."createdAt",
    jmi.id,
    'INITIATED',
    jmi."inputSchema"
  FROM jobs_missing_initiated jmi
  RETURNING id, "jobId"
)
-- Step 2: Insert jobInput linked to the new INITIATED jobStatus
INSERT INTO "jobInput" (
  id,
  "createdAt",
  "updatedAt",
  "statusId",
  input,
  "inputHash",
  signature
)
SELECT
  gen_random_uuid()::text,
  j."createdAt",
  j."createdAt",
  ins.id,
  j.input,
  j."inputHash",
  NULL
FROM inserted_statuses ins
INNER JOIN "Job" j ON j.id = ins."jobId";

-- Step 3: Add partial unique index to ensure only one INITIATED status per job
CREATE UNIQUE INDEX IF NOT EXISTS "jobStatus_jobId_initiated_unique" ON "jobStatus" ("jobId") WHERE status = 'INITIATED';
