-- Fix JobStatus createdAt ordering
-- This migration ensures that:
-- 1. When multiple JobStatus records have the same createdAt, the INITIATED status
--    remains unchanged (same as job.createdAt) and other statuses are adjusted to be
--    a few milliseconds newer to maintain proper ordering.
-- 2. COMPLETED status for demo jobs is always the newest (latest createdAt).
-- 3. AWAITING_PAYMENT statuses are removed for demo jobs.
--
-- Strategy:
-- Part 1: Fix duplicate timestamps
--   - Identify statuses with duplicate createdAt timestamps per job
--   - Leave INITIATED statuses unchanged
--   - Update other statuses incrementally (1ms, 2ms, 3ms, etc.) based on their ID order
-- Part 2: Ensure COMPLETED is newest for demo jobs
--   - Find demo jobs with COMPLETED status
--   - If COMPLETED is not the newest, update it to be max(createdAt) + 1ms
-- Part 3: Remove AWAITING_PAYMENT statuses for demo jobs
--   - Delete all AWAITING_PAYMENT JobStatus records for demo jobs

WITH duplicate_statuses AS (
  -- Find all statuses that have duplicate createdAt values within the same job
  SELECT
    js.id,
    js."jobId",
    js."createdAt",
    js.status,
    j."createdAt" AS job_created_at
  FROM "jobStatus" js
  INNER JOIN "Job" j ON j.id = js."jobId"
  WHERE EXISTS (
    -- Only include statuses that are part of a duplicate group (same createdAt)
    SELECT 1
    FROM "jobStatus" js2
    WHERE js2."jobId" = js."jobId"
      AND js2."createdAt" = js."createdAt"
      AND js2.id != js.id
  )
),
statuses_to_update AS (
  -- Number the non-INITIATED statuses within each duplicate group
  -- INITIATED statuses are excluded and will not be updated
  -- Use the duplicate group's createdAt (which should match job_created_at for INITIATED groups)
  -- as the base timestamp for all adjustments
  SELECT
    id,
    "jobId",
    "createdAt" AS base_timestamp,
    status,
    ROW_NUMBER() OVER (
      PARTITION BY "jobId", "createdAt"
      ORDER BY 
        CASE WHEN status = 'INITIATED' THEN 0 ELSE 1 END,  -- INITIATED first (but we filter it out)
        id  -- Then by ID for stable ordering
    ) AS row_num
  FROM duplicate_statuses
  WHERE status != 'INITIATED'
)
-- Update non-INITIATED statuses to be incrementally newer
-- Each status gets base_timestamp + (row_num milliseconds)
-- This ensures INITIATED (at base_timestamp) remains earliest
UPDATE "jobStatus" js
SET 
  "createdAt" = stu.base_timestamp + (stu.row_num || ' milliseconds')::interval,
  "updatedAt" = stu.base_timestamp + (stu.row_num || ' milliseconds')::interval
FROM statuses_to_update stu
WHERE js.id = stu.id;

-- Ensure COMPLETED status for demo jobs is always the newest (latest createdAt)
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

-- Remove AWAITING_PAYMENT statuses for demo jobs
-- Note: This will cascade delete related JobInput records due to onDelete: Cascade
DELETE FROM "jobStatus" js
USING "Job" j
WHERE js."jobId" = j.id
  AND j."jobType" = 'DEMO'
  AND js.status = 'AWAITING_PAYMENT';

