-- Recompute the denormalized Agent.jobCount after V2 identity consolidation.
--
-- 20260803152000 reassigns Job.agentId from duplicate revision rows onto their
-- canonical row, but never adjusts jobCount. The counter backs the public
-- execution count and the default `jobCount DESC` catalog order, and its only
-- other writer increments on job creation, so nothing else repairs it.
--
-- This runs as its own migration rather than as a fix inside 20260803152000
-- because the ordering is what makes the drift invisible:
--
--   * Production already applied 20260805090000_add_agent_job_count (from
--     main), which backfilled the counter. Prisma applies only PENDING
--     migrations, so 20260803152000 lands AFTER that backfill and the counter
--     is never recomputed.
--   * A fresh database (CI, shadow db) applies migrations in filename order,
--     so there the consolidation runs BEFORE the backfill and the backfill
--     silently repairs it.
--
-- The bug therefore only exists on databases that already had the counter, and
-- no test on a fresh database can reproduce it. Recomputing unconditionally
-- here is correct in both cases: it is idempotent and, on a database where the
-- counter is already right, a no-op in effect.
UPDATE "Agent" agent
SET "jobCount" = COALESCE(job_totals."count", 0)
FROM (
  SELECT
    candidate."id" AS "agentId",
    (SELECT COUNT(*) FROM "Job" job WHERE job."agentId" = candidate."id")
      AS "count"
  FROM "Agent" candidate
) job_totals
WHERE agent."id" = job_totals."agentId"
  AND agent."jobCount" IS DISTINCT FROM COALESCE(job_totals."count", 0);
