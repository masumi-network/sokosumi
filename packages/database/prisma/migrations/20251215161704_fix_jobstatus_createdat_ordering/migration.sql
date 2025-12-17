-- Fix JobStatus createdAt ordering
-- This migration ensures that:
-- 1. AWAITING_PAYMENT statuses are removed for demo jobs
-- 2. INITIATED status has the same createdAt as the Job
-- 3. COMPLETED status for demo jobs is always the newest (latest createdAt)
--
-- Strategy:
-- Part 1: Remove AWAITING_PAYMENT statuses for demo jobs
--   - Delete all AWAITING_PAYMENT JobStatus records for demo jobs
-- Part 2: Ensure INITIATED matches job's createdAt and fix duplicate timestamps
--   - Update INITIATED statuses to match job's createdAt
--   - Adjust other statuses with duplicate timestamps to be incrementally newer
-- Part 3: Ensure COMPLETED is newest for demo jobs
--   - Find demo jobs with COMPLETED status
--   - If COMPLETED is not the newest, update it to be max(createdAt) + 1ms

-- Part 1: Remove AWAITING_PAYMENT statuses for demo jobs
-- Note: This will cascade delete related JobInput, Blob, and Link records due to onDelete: Cascade
DELETE FROM "jobStatus" js
USING "Job" j
WHERE js."jobId" = j.id
  AND j."jobType" = 'DEMO'
  AND js.status = 'AWAITING_PAYMENT';

-- Part 2: Ensure INITIATED status has the same createdAt as the Job
-- First, update INITIATED statuses to match job's createdAt
UPDATE "jobStatus" js
SET 
  "createdAt" = j."createdAt",
  "updatedAt" = j."createdAt"
FROM "Job" j
WHERE js."jobId" = j.id
  AND js.status = 'INITIATED'
  AND js."createdAt" != j."createdAt";

-- Then, fix duplicate timestamps by adjusting non-INITIATED statuses
WITH duplicate_statuses AS (
  -- Find all statuses that have the same createdAt as the job (after INITIATED update)
  SELECT
    js.id,
    js."jobId",
    js."createdAt",
    js.status,
    j."createdAt" AS job_created_at
  FROM "jobStatus" js
  INNER JOIN "Job" j ON j.id = js."jobId"
  WHERE js."createdAt" = j."createdAt"
    AND js.status != 'INITIATED'
),
statuses_to_update AS (
  -- Number the non-INITIATED statuses that have the same timestamp as the job
  SELECT
    id,
    "jobId",
    job_created_at AS base_timestamp,
    status,
    ROW_NUMBER() OVER (
      PARTITION BY "jobId"
      ORDER BY id
    ) AS row_num
  FROM duplicate_statuses
)
-- Update non-INITIATED statuses to be incrementally newer
-- Each status gets job_created_at + (row_num milliseconds)
-- This ensures INITIATED (at job_created_at) remains earliest
UPDATE "jobStatus" js
SET 
  "createdAt" = stu.base_timestamp + (stu.row_num || ' milliseconds')::interval,
  "updatedAt" = stu.base_timestamp + (stu.row_num || ' milliseconds')::interval
FROM statuses_to_update stu
WHERE js.id = stu.id;

-- Part 3: Ensure COMPLETED status for demo jobs is always the newest (latest createdAt)
WITH demo_job_statuses AS (
  -- Find all statuses for demo jobs
  SELECT
    js.id,
    js."jobId",
    js."createdAt",
    js.status,
    MAX(js."createdAt") OVER (PARTITION BY js."jobId") AS max_created_at
  FROM "jobStatus" js
  INNER JOIN "Job" j ON j.id = js."jobId"
  WHERE j."jobType" = 'DEMO'
),
demo_completed_to_update AS (
  -- Find COMPLETED statuses for demo jobs that are not the newest
  SELECT
    id,
    "jobId",
    "createdAt",
    max_created_at
  FROM demo_job_statuses
  WHERE status = 'COMPLETED'
    AND "createdAt" < max_created_at
)
-- Update COMPLETED status to be the newest (max + 1ms to ensure it's definitely the latest)
UPDATE "jobStatus" js
SET 
  "createdAt" = dctu.max_created_at + ('1 millisecond')::interval,
  "updatedAt" = dctu.max_created_at + ('1 millisecond')::interval
FROM demo_completed_to_update dctu
WHERE js.id = dctu.id;
