-- Read-only report for the Task Schedule cutover (SOK-1172, ADR 0041).
--
--   psql "$DB" -X -v ON_ERROR_STOP=1 -f task-schedule-cutover-report.sql
--
-- Before 20260924120000_task_schedule_cutover it says what the migration will
-- do with the data; after it, it checks the result. Every check in the
-- "must be 0" section is an invariant: anything other than 0 is a finding.
-- It changes nothing: its only objects are temporary views, and it ends in
-- ROLLBACK, so it is safe against production. Needs Postgres 16+
-- (pg_input_is_valid).
\set ON_ERROR_STOP 1
\pset footer off

BEGIN;

SELECT to_regclass('"task_schedule_run"') IS NOT NULL AS migrated \gset

\if :migrated

\echo '== After the cutover =='

\echo '-- Task Schedules by state and end rule'
SELECT state, "endsMode", count(*) AS schedules,
  count(*) FILTER (WHERE "intervalDays" > 1) AS every_n_days
FROM "task_schedule"
GROUP BY 1, 2
ORDER BY 1, 2;

\echo '-- Runs by parent and state'
SELECT
  CASE WHEN "scheduleId" IS NOT NULL THEN 'task schedule' ELSE 'legacy series (SOK-1174 removes)' END AS parent,
  state, count(*) AS runs
FROM "task_schedule_run"
GROUP BY 1, 2
ORDER BY 1, 2;

\echo '-- Due right after the deploy: the first release cron creates these'
SELECT
  (SELECT count(*) FROM "task_schedule" WHERE state = 'ACTIVE' AND "nextRunAt" <= now()) AS schedules_due,
  (SELECT count(*) FROM "task_schedule_run" r JOIN "task_schedule" s ON s.id = r."scheduleId"
   WHERE s.state = 'ACTIVE' AND r.state = 'PLANNED' AND r."effectiveScheduledAt" <= now()) AS runs_due,
  (SELECT count(*) FROM "task" WHERE status = 'QUEUED' AND "archivedAt" IS NULL AND "runAt" <= now()) AS run_ats_due,
  (SELECT min("nextRunAt") FROM "task_schedule" WHERE state = 'ACTIVE') AS oldest_next_run;

\echo '-- Must be 0'
SELECT 'Active schedule without a next run' AS invariant, count(*) AS violations
FROM "task_schedule" WHERE state = 'ACTIVE' AND "nextRunAt" IS NULL
UNION ALL
SELECT 'Active schedule whose next run is not after its last release', count(*)
FROM "task_schedule" s
WHERE s.state = 'ACTIVE' AND s."nextRunAt" <= (
  SELECT max(r."effectiveScheduledAt") FROM "task_schedule_run" r
  WHERE r."scheduleId" = s.id AND r.state = 'RELEASED'
)
UNION ALL
SELECT 'Planned Run due before a released one of its schedule', count(*)
FROM "task_schedule_run" planned
WHERE planned.state = 'PLANNED' AND planned."scheduleId" IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM "task_schedule_run" released
    WHERE released."scheduleId" = planned."scheduleId" AND released.state = 'RELEASED'
      AND released."effectiveScheduledAt" >= planned."effectiveScheduledAt"
  )
UNION ALL
SELECT 'Paused or Ended schedule with a next run', count(*)
FROM "task_schedule" WHERE state <> 'ACTIVE' AND "nextRunAt" IS NOT NULL
UNION ALL
SELECT 'Unarchived Task still holding a recurring rule', count(*)
FROM "task" t
WHERE t."archivedAt" IS NULL AND pg_input_is_valid(t.metadata, 'jsonb')
  AND t.metadata::JSONB->>'mode' = 'recurring' AND t.metadata::JSONB->>'version' IN ('1', '2')
UNION ALL
SELECT 'Unarchived Task still woken by the old release (nextRunAt)', count(*)
FROM "task" WHERE "archivedAt" IS NULL AND "nextRunAt" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "task_schedule_quarantine" q WHERE q."taskId" = "task".id)
UNION ALL
SELECT 'Run at on a Task that is not Queued', count(*)
FROM "task" WHERE "runAt" IS NOT NULL AND status <> 'QUEUED'
UNION ALL
SELECT 'Task released by a series link without scheduleId', count(*)
FROM "task_link" link
JOIN "task" template ON template.id = link."fromTaskId"
JOIN "task" released ON released.id = link."toTaskId"
WHERE link.type = 'SCHEDULE' AND released."scheduleId" IS NULL
  AND EXISTS (
    SELECT 1 FROM "task_schedule" s
    WHERE s.id = md5('task-schedule-cutover:schedule:' || template.id)::UUID
  );

\echo '-- Left for operator repair before SOK-1174 (quarantined Queued one-time schedules)'
SELECT t.id, t.status, t."nextRunAt", q.reason
FROM "task" t
JOIN "task_schedule_quarantine" q ON q."taskId" = t.id
WHERE t."archivedAt" IS NULL AND pg_input_is_valid(t.metadata, 'jsonb')
  AND t.metadata::JSONB->>'mode' = 'once'
ORDER BY t.id
LIMIT 50;

\else

\echo '== Before the cutover: what it will do =='

CREATE TEMP VIEW report_task AS
SELECT
  t.id, t.status, t."archivedAt", t."nextRunAt", t."projectId",
  t."assigneeId", t."assigneeUserId", t."assigneeSokoBotId",
  t.metadata IS NOT NULL AS has_metadata,
  CASE WHEN pg_input_is_valid(t.metadata, 'jsonb') THEN t.metadata::JSONB END AS rule,
  EXISTS (SELECT 1 FROM "task_schedule_quarantine" q WHERE q."taskId" = t.id) AS quarantined
FROM "task" t
WHERE t.metadata IS NOT NULL OR t."nextRunAt" IS NOT NULL;

\echo '-- Task.metadata by kind (only schedule JSON is expected)'
SELECT
  CASE
    WHEN rule IS NULL AND has_metadata THEN 'not JSON'
    WHEN NOT has_metadata THEN 'no metadata, nextRunAt set'
    WHEN rule->>'version' IN ('1', '2') AND rule->>'mode' IN ('once', 'recurring')
      THEN 'v' || (rule->>'version') || ' ' || (rule->>'mode')
    ELSE 'other JSON (not a schedule)'
  END AS kind,
  count(*) FILTER (WHERE "archivedAt" IS NULL) AS live,
  count(*) FILTER (WHERE "archivedAt" IS NOT NULL) AS archived
FROM report_task
GROUP BY 1
ORDER BY 1;

CREATE TEMP VIEW report_series AS
SELECT
  r.*,
  rule->>'version' AS version,
  COALESCE(rule->>'endsMode', 'never') AS ends_mode,
  CASE
    WHEN COALESCE(rule->>'endsMode', 'never') = 'never' THEN true
    WHEN rule->>'endsMode' = 'on' THEN pg_input_is_valid(rule->>'endsOn', 'timestamptz')
    WHEN rule->>'endsMode' = 'after' THEN jsonb_typeof(rule->(CASE WHEN rule->>'version' = '1' THEN 'occurrences' ELSE 'targetReleaseCount' END)) = 'number'
    ELSE false
  END AS end_rule_ok,
  btrim(rule->>'expr') ~ '^\d+ \d+ \*/\d+ \* \*$' AND jsonb_typeof(rule->'intervalDays') IS DISTINCT FROM 'number' AS cron_interval,
  COALESCE(rule->>'timezone', 'UTC') AS timezone
FROM report_task r
WHERE "archivedAt" IS NULL
  AND rule->>'mode' = 'recurring' AND rule->>'version' IN ('1', '2')
  AND NULLIF(btrim(rule->>'expr'), '') IS NOT NULL;

\echo '-- Recurring series: the state each becomes, and why'
SELECT
  CASE
    WHEN status = 'QUEUED' AND NOT quarantined AND "nextRunAt" IS NOT NULL AND end_rule_ok THEN 'ACTIVE'
    ELSE 'PAUSED'
  END AS becomes,
  CASE
    WHEN quarantined THEN 'quarantined'
    WHEN status = 'READY' AND "assigneeUserId" IS NOT NULL THEN 'person-assigned, Ready'
    WHEN status <> 'QUEUED' THEN 'status ' || status
    WHEN "nextRunAt" IS NULL THEN 'no next run'
    WHEN NOT end_rule_ok THEN 'broken end rule (runs as never)'
    ELSE ''
  END AS reason,
  version, ends_mode, count(*) AS series,
  count(*) FILTER (WHERE cron_interval) AS cron_every_n_days,
  count(*) FILTER (WHERE "nextRunAt" <= now()) AS overdue
FROM report_series
GROUP BY 1, 2, 3, 4
ORDER BY 1, 2, 3, 4;

\echo '-- Series whose timezone Postgres does not know (Core may reject them on resume or edit)'
SELECT id, timezone, status, quarantined
FROM report_series
WHERE timezone NOT IN (SELECT name FROM pg_timezone_names)
ORDER BY id
LIMIT 50;

\echo '-- Ledger rows by what they belong to'
SELECT
  CASE
    WHEN o."seriesTaskId" = o."releasedTaskId" AND NOT EXISTS (
      SELECT 1 FROM "task_schedule_quarantine" q WHERE q."taskId" = o."seriesTaskId"
        AND t.status = 'QUEUED'
    ) THEN 'one-time, released onto itself (removed)'
    WHEN s.id IS NOT NULL THEN 'live series (moves to its schedule)'
    WHEN t."archivedAt" IS NOT NULL THEN 'archived template (stays, SOK-1174)'
    ELSE 'ended series or one-time (see below)'
  END AS owner,
  o.state,
  CASE
    WHEN o."legacyLinkId" IS NOT NULL THEN 'approximate v1 release'
    ELSE 'v' || o."scheduleVersion"
  END AS shape,
  count(*) AS rows
FROM "task_schedule_occurrence" o
JOIN "task" t ON t.id = o."seriesTaskId"
LEFT JOIN report_series s ON s.id = o."seriesTaskId"
GROUP BY 1, 2, 3
ORDER BY 1, 2, 3;

\echo '-- Released Tasks that get scheduleId (SCHEDULE links from live series)'
SELECT count(*) AS released_tasks
FROM "task_link" link
JOIN report_series s ON s.id = link."fromTaskId"
WHERE link.type = 'SCHEDULE';

\echo '-- One-time schedules'
SELECT
  rule->>'version' AS version, status, quarantined,
  CASE
    WHEN quarantined AND status = 'QUEUED' THEN 'left as is (operator repair)'
    WHEN status = 'QUEUED' THEN 'gets a Run at'
    ELSE 'cleared, no Run at (never released under the old rule)'
  END AS outcome,
  count(*) AS tasks,
  count(*) FILTER (WHERE "nextRunAt" <= now()) AS overdue
FROM report_task
WHERE "archivedAt" IS NULL AND rule->>'mode' = 'once' AND rule->>'version' IN ('1', '2')
GROUP BY 1, 2, 3, 4
ORDER BY 1, 2, 3;

\echo '-- Would stop the migration: v1 planned rows sharing a rule time (expect 0)'
SELECT count(*) AS duplicates
FROM (
  SELECT "seriesTaskId", "originalScheduledAt"
  FROM "task_schedule_occurrence"
  WHERE "scheduleVersion" = 1 AND "legacyLinkId" IS NULL
  GROUP BY 1, 2
  HAVING count(*) > 1
) AS dup;

\endif

ROLLBACK;
