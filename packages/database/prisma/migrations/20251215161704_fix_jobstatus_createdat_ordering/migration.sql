-- Fix JobStatus createdAt ordering
-- This migration ensures that when multiple JobStatus records have the same createdAt,
-- the INITIATED status remains unchanged (same as job.createdAt) and other statuses
-- are adjusted to be a few milliseconds newer to maintain proper ordering.
--
-- Strategy:
-- 1. Identify statuses with duplicate createdAt timestamps per job
-- 2. Leave INITIATED statuses unchanged
-- 3. Update other statuses incrementally (1ms, 2ms, 3ms, etc.) based on their ID order

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

