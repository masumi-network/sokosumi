-- Recompute the denormalized Agent.jobCount after V2 identity consolidation.
--
-- 20260805132000 reassigns Job.agentId from duplicate revision rows onto their
-- canonical row, but never adjusts jobCount. The counter backs the public
-- execution count and the default `jobCount DESC` catalog order, and its only
-- other writer increments on job creation, so nothing else repairs it.
--
-- This runs as its own migration rather than as a fix inside 20260805132000
-- because consolidation always lands AFTER 20260805090000_add_agent_job_count
-- (payment-v2 migrations are timestamped after the main tip that includes that
-- backfill). The backfill therefore never sees the post-consolidation agentId
-- map, and the counter drifts until this recompute.
--
-- Idempotent: on a database where the counter is already right, a no-op in
-- effect.
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
