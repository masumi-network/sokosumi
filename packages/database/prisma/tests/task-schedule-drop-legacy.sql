-- Run with psql -v ON_ERROR_STOP=1 -f this-file.sql right after
-- task-schedule-cutover.sql, against the same disposable database: it takes
-- the cutover's fixtures as they were left and applies
-- 20260924143117_task_schedule_drop_legacy on top.
--
-- The drop removes the old series columns (ADR 0041). This test proves it
-- refuses while the cutover left a Task for operator repair, and that every
-- migrated schedule, Run, and Task survives it unchanged.
\set ON_ERROR_STOP 1
\set QUIET 1

DO $$
BEGIN
  IF to_regclass('"task_schedule_quarantine"') IS NULL
    OR (SELECT count(*) FROM "task_schedule") <> 6 THEN
    RAISE EXCEPTION 'Needs the database task-schedule-cutover.sql left behind';
  END IF;
END;
$$;

CREATE FUNCTION pg_temp.expect(ok BOOLEAN, message TEXT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF ok IS NOT TRUE THEN
    RAISE EXCEPTION 'Task Schedule drop: %', message;
  END IF;
END;
$$;

CREATE FUNCTION pg_temp.has_column(table_name TEXT, column_name TEXT)
RETURNS BOOLEAN
LANGUAGE sql
AS $$
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns AS c
    WHERE c.table_schema = current_schema()
      AND c.table_name = has_column.table_name
      AND c.column_name = has_column.column_name
  )
$$;

-- Fixtures on top of the cutover's ---------------------------------------------

-- A schedule-only event goes; one that also recorded a status keeps it.
INSERT INTO "taskEvent" (id, "updatedAt", "taskId", status, "scheduleKind", "scheduleOperationId") VALUES
  ('event-schedule-only', now(), 'v2', NULL, 'OCCURRENCE_SKIPPED', 'aaaaaaaa-0000-4000-8000-000000000001'),
  ('event-with-status', now(), 'v2', 'QUEUED', 'CREATED', 'aaaaaaaa-0000-4000-8000-000000000002'),
  ('event-plain', now(), 'v2', 'READY', NULL, NULL);

-- A create operation of the retired POST /v1/tasks/scheduled.
INSERT INTO "task_schedule_create_operation" (id, "workspaceId", "operationId", "requestFingerprint", "taskId") VALUES
  ('bbbbbbbb-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111',
   'bbbbbbbb-0000-4000-8000-000000000002', 'fingerprint', 'v2');

-- Refused while a Task waits for repair ----------------------------------------

-- The quarantined Queued one-time Task the cutover left still holds its
-- rule, and two Tasks hold metadata that is not a schedule. psql prints the
-- refusal, then every statement of the aborted transaction.
\echo 'task-schedule-drop-legacy: expect the refusal and aborted statements below'
\set ON_ERROR_STOP 0
\set VERBOSITY terse
\ir ../migrations/20260924143117_task_schedule_drop_legacy/migration.sql
\set VERBOSITY default
\set ON_ERROR_STOP 1

DO $$
BEGIN
  PERFORM pg_temp.expect(
    pg_temp.has_column('task', 'metadata')
      AND to_regclass('"task_schedule_quarantine"') IS NOT NULL
      AND (SELECT count(*) FROM "task_link" WHERE type = 'SCHEDULE') = 5,
    'the drop refuses as a whole while a Task still holds a schedule'
  );
END;
$$;

-- The operator repair: the one-time schedule becomes the Task's Run at, as
-- the cutover does for any other Queued one-time schedule, and metadata that
-- is not a schedule is cleared once someone has looked at it.
UPDATE "task"
SET "runAt" = "nextRunAt", metadata = NULL, "nextRunAt" = NULL
WHERE id = 'once-quarantined';
DELETE FROM "task_schedule_quarantine" WHERE "taskId" = 'once-quarantined';
UPDATE "task" SET metadata = NULL WHERE id IN ('not-a-schedule', 'malformed');

DO $$
BEGIN
  PERFORM pg_temp.expect(
    NOT EXISTS (SELECT 1 FROM "task" WHERE metadata IS NOT NULL AND "archivedAt" IS NULL),
    'after the repair only archived templates hold a rule'
  );
END;
$$;

-- What must survive ---------------------------------------------------------------

CREATE TEMP TABLE before_drop AS
SELECT
  (SELECT md5(string_agg(s::TEXT, '|' ORDER BY s.id)) FROM "task_schedule" AS s) AS schedules,
  (SELECT md5(string_agg(r::TEXT, '|' ORDER BY r.id)) FROM (
     SELECT id, "scheduleId", "releasedTaskId", "epochId", "originalScheduledAt",
       "effectiveScheduledAt", state, "sourceWorkspaceId", "sourceType",
       "sourceProjectId", "actorUserId", "actorCoworkerId", timezone
     FROM "task_schedule_run" WHERE "scheduleId" IS NOT NULL
   ) AS r) AS runs,
  (SELECT md5(string_agg(t::TEXT, '|' ORDER BY t.id)) FROM (
     SELECT id, name, status, "archivedAt", "scheduleId", "runAt", "projectId",
       "assigneeId", "assigneeUserId", "assigneeSokoBotId"
     FROM "task"
   ) AS t) AS tasks;

-- Drop -------------------------------------------------------------------------

\ir ../migrations/20260924143117_task_schedule_drop_legacy/migration.sql

DO $$
DECLARE
  before before_drop%ROWTYPE;
BEGIN
  SELECT * INTO before FROM before_drop;

  PERFORM pg_temp.expect(
    before.schedules = (SELECT md5(string_agg(s::TEXT, '|' ORDER BY s.id)) FROM "task_schedule" AS s),
    'every Task Schedule survives the drop unchanged'
  );
  PERFORM pg_temp.expect(
    before.runs = (SELECT md5(string_agg(r::TEXT, '|' ORDER BY r.id)) FROM (
      SELECT id, "scheduleId", "releasedTaskId", "epochId", "originalScheduledAt",
        "effectiveScheduledAt", state, "sourceWorkspaceId", "sourceType",
        "sourceProjectId", "actorUserId", "actorCoworkerId", timezone
      FROM "task_schedule_run"
    ) AS r),
    'every Task Schedule Run survives the drop unchanged, and only those'
  );
  PERFORM pg_temp.expect(
    before.tasks = (SELECT md5(string_agg(t::TEXT, '|' ORDER BY t.id)) FROM (
      SELECT id, name, status, "archivedAt", "scheduleId", "runAt", "projectId",
        "assigneeId", "assigneeUserId", "assigneeSokoBotId"
      FROM "task"
    ) AS t),
    'every Task survives the drop with its status, scheduleId, and Run at'
  );

  PERFORM pg_temp.expect(
    NOT EXISTS (
      SELECT 1 FROM "task_schedule_run"
      WHERE id IN ('f0000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000002')
    ),
    'ledger rows of an archived series and of the repaired Task are gone'
  );
  PERFORM pg_temp.expect(
    (SELECT "runAt" = '2030-02-03 09:00' AND status = 'QUEUED' FROM "task" WHERE id = 'once-quarantined'),
    'the repaired Task keeps its Run at'
  );

  PERFORM pg_temp.expect(
    (SELECT array_agg(id ORDER BY id) FROM "task_link") = ARRAY['link-relates'],
    'SCHEDULE links are gone; other links stay'
  );
  PERFORM pg_temp.expect(
    (SELECT array_agg(id ORDER BY id) FROM "taskEvent" WHERE "taskId" = 'v2') = ARRAY['event-plain', 'event-with-status']
      AND (SELECT status = 'QUEUED' FROM "taskEvent" WHERE id = 'event-with-status'),
    'a schedule-only event goes; an event with a status keeps it'
  );
  PERFORM pg_temp.expect(
    NOT EXISTS (SELECT 1 FROM "task_schedule_create_operation")
      AND pg_temp.has_column('task_schedule_create_operation', 'scheduleId')
      AND NOT pg_temp.has_column('task_schedule_create_operation', 'taskId'),
    'the create-operation ledger keys Task Schedules and starts empty'
  );

  PERFORM pg_temp.expect(
    NOT pg_temp.has_column('task', 'metadata')
      AND NOT pg_temp.has_column('task', 'nextRunAt')
      AND NOT pg_temp.has_column('task', 'scheduleRevision')
      AND NOT pg_temp.has_column('task_schedule_run', 'seriesTaskId')
      AND NOT pg_temp.has_column('task_schedule_run', 'legacyLinkId')
      AND NOT pg_temp.has_column('task_schedule_run', 'scheduleVersion')
      AND NOT pg_temp.has_column('task_schedule_run', 'ruleSnapshot')
      AND NOT pg_temp.has_column('task_schedule_run', 'sourceAccuracy')
      AND NOT pg_temp.has_column('task_schedule_run', 'timeAccuracy')
      AND NOT pg_temp.has_column('taskEvent', 'scheduleKind')
      AND to_regclass('"task_schedule_quarantine"') IS NULL
      AND to_regtype('"TaskScheduleQuarantineReason"') IS NULL
      AND to_regtype('"TaskScheduleEventKind"') IS NULL
      AND to_regtype('"CalendarSourceAccuracy"') IS NULL
      AND to_regtype('"CalendarTimeAccuracy"') IS NULL
      AND to_regprocedure('prevent_project_delete_with_calendar_history()') IS NULL,
    'the old columns, table, types, and guard are gone'
  );
  PERFORM pg_temp.expect(
    enum_range(NULL::"TaskLinkType")::TEXT = '{RELATES,BLOCKS,PARENT,DUPLICATE}'
      AND enum_range(NULL::"CalendarSourceType")::TEXT = '{WORKSPACE,PROJECT}',
    'SCHEDULE and LEGACY_UNKNOWN are gone from their enums'
  );
END;
$$;

-- The rewritten triggers run, and still invalidate the Calendar.
DELETE FROM "calendar_invalidation_outbox";
UPDATE "task_schedule_run"
SET "effectiveScheduledAt" = "effectiveScheduledAt" + INTERVAL '1 hour'
WHERE id = 'b0000000-0000-4000-8000-000000000004';
UPDATE "task" SET name = 'Once v1, renamed' WHERE id = 'once-v1';
UPDATE "task" SET name = 'Weekly v1, released' WHERE id = 'v1-release-a';
UPDATE "task" SET name = 'Other metadata, renamed' WHERE id = 'not-a-schedule';

DO $$
BEGIN
  PERFORM pg_temp.expect(
    (SELECT count(*) FROM "calendar_invalidation_outbox") = 3,
    'a Run change, a Task with a Run at, and a released Task invalidate the Calendar; a plain Task does not: '
      || (SELECT count(*) FROM "calendar_invalidation_outbox")
  );
END;
$$;

\echo 'task-schedule-drop-legacy: ok'
