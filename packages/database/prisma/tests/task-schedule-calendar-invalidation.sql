-- Run with psql -v ON_ERROR_STOP=1 -f this-file.sql against a disposable database.
-- A Task Schedule's planned Runs show its name, owner, and assignee, so a
-- change to those must reach the Calendar even though no Run row changes.
BEGIN;
CREATE SCHEMA task_schedule_calendar_test;
SET LOCAL search_path TO task_schedule_calendar_test;
CREATE TYPE "TaskScheduleState" AS ENUM ('ACTIVE', 'PAUSED', 'ENDED');
CREATE TYPE "TaskVisibility" AS ENUM ('PUBLIC', 'PRIVATE');
CREATE TABLE task_schedule (
  id uuid PRIMARY KEY,
  "workspaceId" uuid NOT NULL,
  "projectId" uuid,
  "ownerId" text NOT NULL,
  state "TaskScheduleState" NOT NULL DEFAULT 'ACTIVE',
  visibility "TaskVisibility" NOT NULL DEFAULT 'PUBLIC',
  name text NOT NULL,
  "assigneeId" text,
  "assigneeSokoBotId" uuid,
  "assigneeUserId" text,
  revision integer NOT NULL DEFAULT 0,
  "nextRunAt" timestamp(3),
  "releasedCount" integer NOT NULL DEFAULT 0
);
CREATE TABLE captured_outbox (workspace_id uuid, old_project_id uuid, new_project_id uuid, payload jsonb);
CREATE FUNCTION enqueue_calendar_invalidation(uuid, uuid, uuid, jsonb) RETURNS void LANGUAGE sql AS $$ INSERT INTO captured_outbox VALUES ($1, $2, $3, $4) $$;
\ir ../migrations/20260923200000_task_schedule_calendar_invalidation/migration.sql
INSERT INTO task_schedule (id, "workspaceId", "projectId", "ownerId", name) VALUES
  ('33333333-3333-4333-8333-333333333333', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', 'u1', 'Weekly report');
DO $$
BEGIN
  IF EXISTS (SELECT FROM captured_outbox) THEN
    RAISE EXCEPTION 'A new schedule has no Runs on the Calendar yet';
  END IF;
END;
$$;
-- The release advances its bookkeeping every Run; its Run row already tells the Calendar.
UPDATE task_schedule SET "nextRunAt" = now(), "releasedCount" = 1;
DO $$
BEGIN
  IF EXISTS (SELECT FROM captured_outbox) THEN
    RAISE EXCEPTION 'Release bookkeeping must not invalidate the Calendar';
  END IF;
END;
$$;
UPDATE task_schedule SET name = 'Weekly summary';
DO $$
BEGIN
  IF (SELECT count(*) FROM captured_outbox) <> 1
    OR (SELECT payload->>'scheduleId' FROM captured_outbox) IS DISTINCT FROM '33333333-3333-4333-8333-333333333333'
    OR (SELECT workspace_id FROM captured_outbox) IS DISTINCT FROM '11111111-1111-4111-8111-111111111111'
    OR (SELECT new_project_id FROM captured_outbox) IS DISTINCT FROM '22222222-2222-4222-8222-222222222222' THEN
    RAISE EXCEPTION 'A rename must invalidate the schedule''s Calendar scope';
  END IF;
END;
$$;
DELETE FROM captured_outbox;
UPDATE task_schedule SET state = 'PAUSED';
UPDATE task_schedule SET "assigneeUserId" = 'u2';
UPDATE task_schedule SET "projectId" = NULL;
DO $$
BEGIN
  IF (SELECT count(*) FROM captured_outbox) <> 3
    OR NOT EXISTS (
      SELECT FROM captured_outbox
      WHERE old_project_id = '22222222-2222-4222-8222-222222222222' AND new_project_id IS NULL
    ) THEN
    RAISE EXCEPTION 'State, assignee, and project changes must each invalidate the Calendar';
  END IF;
END;
$$;
ROLLBACK;
