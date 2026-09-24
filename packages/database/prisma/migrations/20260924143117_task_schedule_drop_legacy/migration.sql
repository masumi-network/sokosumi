-- ADR 0041 contract step (SOK-1174): after the cutover, the old per-Task
-- series leaves the schema. Dropped: Task.metadata, Task.nextRunAt,
-- Task.scheduleRevision, the quarantine table, the SCHEDULE link type, the
-- schedule fields on Task events, and the Run ledger's series parent and
-- legacy fields. The create-operation ledger moves from Task to Task
-- Schedule. Rollback is the pre-deploy snapshot.
--
-- Not backward-compatible with the previous Core release, like the cutover
-- it ships with: that release still reads the dropped columns, so its
-- schedule, calendar, and Task endpoints fail until the new deployment is
-- promoted. ADR 0041 accepts the single deploy.
--
-- Runs in the same deploy as 20260924130000_task_schedule_cutover. Only
-- history goes: ledger rows of series that had ended or were archived before
-- the cutover, schedule-only Task events, SCHEDULE links (the cutover moved
-- them to Task.scheduleId), and the rule text on archived templates (the
-- Task Schedule holds it now). A schedule the cutover could not move, or
-- metadata that is not a schedule at all, stops the migration instead.

BEGIN;

-- 1. Task.metadata goes whole, so it may only hold what the cutover already
-- moved: a rule on an archived template. Refused: a Task the cutover left
-- for an operator (a quarantined Queued one-time schedule, say; listed by
-- task-schedule-cutover-report.sql), and metadata that is not a v1 or v2
-- schedule at all (Core never writes any; the report counts it as "other
-- JSON" or "not JSON"). Repair or clear them first.
CREATE FUNCTION pg_temp.drop_legacy_jsonb(value TEXT)
RETURNS JSONB
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  RETURN value::JSONB;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;

DO $$
DECLARE
  leftover_count INTEGER;
  leftover_ids TEXT;
BEGIN
  SELECT count(*), string_agg(id, ', ' ORDER BY id) FILTER (WHERE rn <= 20)
  INTO leftover_count, leftover_ids
  FROM (
    SELECT t.id, row_number() OVER (ORDER BY t.id) AS rn
    FROM "task" AS t
    CROSS JOIN LATERAL pg_temp.drop_legacy_jsonb(t.metadata) AS rule
    WHERE t.metadata IS NOT NULL
      AND (
        t."archivedAt" IS NULL
        OR NOT COALESCE(
          rule->>'version' IN ('1', '2') AND rule->>'mode' IN ('once', 'recurring'),
          false
        )
      )
  ) AS leftover;

  IF leftover_count > 0 THEN
    RAISE EXCEPTION 'Task Schedule drop: % Task(s) hold metadata the cutover did not move (a schedule left for repair, or not a schedule); repair or clear them before this migration: %',
      leftover_count, leftover_ids;
  END IF;
END;
$$;

-- 2. Ledger rows without a Task Schedule belong to series that had ended or
-- were archived before the cutover.
DELETE FROM "task_schedule_run" WHERE "scheduleId" IS NULL;

-- 3. The ledger trigger, without the dropped columns. The payload keeps its
-- "occurrence_changed" kind for the Calendar outbox consumer.
CREATE OR REPLACE FUNCTION invalidate_calendar_for_run_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  workspace_id UUID;
  old_workspace_id UUID;
  new_workspace_id UUID;
  old_project_id UUID;
  new_project_id UUID;
  run_id UUID;
BEGIN
  IF TG_OP = 'UPDATE' AND ROW(
    OLD."scheduleId", OLD."releasedTaskId", OLD."epochId",
    OLD."originalScheduledAt", OLD."effectiveScheduledAt", OLD.state,
    OLD."sourceWorkspaceId", OLD."sourceType", OLD."sourceProjectId",
    OLD."actorUserId"
  ) IS NOT DISTINCT FROM ROW(
    NEW."scheduleId", NEW."releasedTaskId", NEW."epochId",
    NEW."originalScheduledAt", NEW."effectiveScheduledAt", NEW.state,
    NEW."sourceWorkspaceId", NEW."sourceType", NEW."sourceProjectId",
    NEW."actorUserId"
  ) THEN
    RETURN NEW;
  END IF;

  IF TG_OP <> 'INSERT' THEN
    old_workspace_id := OLD."sourceWorkspaceId";
    old_project_id := OLD."sourceProjectId";
    run_id := OLD.id;
  END IF;
  IF TG_OP <> 'DELETE' THEN
    new_workspace_id := NEW."sourceWorkspaceId";
    new_project_id := NEW."sourceProjectId";
    run_id := NEW.id;
  END IF;

  IF old_workspace_id IS DISTINCT FROM new_workspace_id THEN
    IF old_workspace_id IS NOT NULL THEN
      PERFORM enqueue_calendar_invalidation(
        old_workspace_id,
        old_project_id,
        NULL,
        jsonb_build_object(
          'kind', 'occurrence_changed',
          'operation', lower(TG_OP),
          'occurrenceId', run_id
        )
      );
    END IF;

    IF new_workspace_id IS NOT NULL THEN
      PERFORM enqueue_calendar_invalidation(
        new_workspace_id,
        NULL,
        new_project_id,
        jsonb_build_object(
          'kind', 'occurrence_changed',
          'operation', lower(TG_OP),
          'occurrenceId', run_id
        )
      );
    END IF;
  ELSE
    workspace_id := COALESCE(new_workspace_id, old_workspace_id);
    PERFORM enqueue_calendar_invalidation(
      workspace_id,
      old_project_id,
      new_project_id,
      jsonb_build_object(
        'kind', 'occurrence_changed',
        'operation', lower(TG_OP),
        'occurrenceId', run_id
      )
    );
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$$;

-- 4. The Task trigger, without the dropped columns: a Task is on the
-- Calendar through its Run at or as a released Run.
CREATE OR REPLACE FUNCTION invalidate_calendar_for_task_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  task_id TEXT;
  workspace_id UUID;
  old_workspace_id UUID;
  new_workspace_id UUID;
  old_project_id UUID;
  new_project_id UUID;
  calendar_relevant BOOLEAN;
BEGIN
  IF TG_OP = 'INSERT' THEN
    task_id := NEW.id;
    new_workspace_id := NEW."workspaceId";
    new_project_id := NEW."projectId";
    calendar_relevant := NEW."runAt" IS NOT NULL;
  ELSIF TG_OP = 'DELETE' THEN
    task_id := OLD.id;
    old_workspace_id := OLD."workspaceId";
    old_project_id := OLD."projectId";
    calendar_relevant := OLD."runAt" IS NOT NULL;
  ELSE
    task_id := NEW.id;
    old_workspace_id := OLD."workspaceId";
    new_workspace_id := NEW."workspaceId";
    old_project_id := OLD."projectId";
    new_project_id := NEW."projectId";
    IF ROW(
      OLD."workspaceId", OLD."projectId", OLD."ownerId", OLD.name,
      OLD.status, OLD."assigneeId", OLD."assigneeUserId", OLD."assigneeSokoBotId",
      OLD."archivedAt", OLD."runAt"
    ) IS NOT DISTINCT FROM ROW(
      NEW."workspaceId", NEW."projectId", NEW."ownerId", NEW.name,
      NEW.status, NEW."assigneeId", NEW."assigneeUserId", NEW."assigneeSokoBotId",
      NEW."archivedAt", NEW."runAt"
    ) THEN
      RETURN NEW;
    END IF;
    calendar_relevant := OLD."runAt" IS NOT NULL OR NEW."runAt" IS NOT NULL;
  END IF;

  IF NOT calendar_relevant THEN
    SELECT EXISTS (
      SELECT 1
      FROM "task_schedule_run"
      WHERE "releasedTaskId" = task_id
    ) INTO calendar_relevant;
  END IF;

  IF calendar_relevant AND old_workspace_id IS DISTINCT FROM new_workspace_id THEN
    IF old_workspace_id IS NOT NULL THEN
      PERFORM enqueue_calendar_invalidation(
        old_workspace_id,
        old_project_id,
        NULL,
        jsonb_build_object(
          'kind', 'task_changed',
          'operation', lower(TG_OP),
          'taskId', task_id
        )
      );
    END IF;

    IF new_workspace_id IS NOT NULL THEN
      PERFORM enqueue_calendar_invalidation(
        new_workspace_id,
        NULL,
        new_project_id,
        jsonb_build_object(
          'kind', 'task_changed',
          'operation', lower(TG_OP),
          'taskId', task_id
        )
      );
    END IF;
  ELSIF calendar_relevant THEN
    workspace_id := COALESCE(new_workspace_id, old_workspace_id);
    PERFORM enqueue_calendar_invalidation(
      workspace_id,
      old_project_id,
      new_project_id,
      jsonb_build_object(
        'kind', 'task_changed',
        'operation', lower(TG_OP),
        'taskId', task_id
      )
    );
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$$;

-- 5. The project delete guard read the old series columns. Projects are no
-- longer deleted (#5083); closing one ends its Task Schedules instead.
DROP TRIGGER IF EXISTS project_calendar_history_delete_guard ON "project";
DROP FUNCTION IF EXISTS prevent_project_delete_with_calendar_history();

-- 6. SCHEDULE links: the cutover moved them to Task.scheduleId.
DELETE FROM "task_link" WHERE type::TEXT = 'SCHEDULE';

CREATE TYPE "TaskLinkType_new" AS ENUM ('RELATES', 'BLOCKS', 'PARENT', 'DUPLICATE');
ALTER TABLE "task_link" ALTER COLUMN "type" TYPE "TaskLinkType_new" USING ("type"::TEXT::"TaskLinkType_new");
ALTER TYPE "TaskLinkType" RENAME TO "TaskLinkType_old";
ALTER TYPE "TaskLinkType_new" RENAME TO "TaskLinkType";
DROP TYPE "TaskLinkType_old";

-- 7. Task events: a schedule-only event goes; one that also recorded a
-- status keeps it.
DELETE FROM "taskEvent" WHERE "scheduleKind" IS NOT NULL AND status IS NULL;

DROP INDEX "taskEvent_taskId_scheduleOperationId_key";
ALTER TABLE "taskEvent"
  DROP COLUMN "scheduleKind",
  DROP COLUMN "schedulePayload",
  DROP COLUMN "scheduleOperationId";
DROP TYPE "TaskScheduleEventKind";

-- 8. Quarantine: every quarantined series is a Paused Task Schedule now.
DROP TABLE "task_schedule_quarantine";
DROP TYPE "TaskScheduleQuarantineReason";

-- 9. The create-operation ledger keys Task Schedules. Its rows were for the
-- retired POST /v1/tasks/scheduled; that route answers 410, so none replay.
DELETE FROM "task_schedule_create_operation";
ALTER TABLE "task_schedule_create_operation" DROP CONSTRAINT "task_schedule_create_operation_taskId_fkey";
DROP INDEX "task_schedule_create_operation_taskId_key";
ALTER TABLE "task_schedule_create_operation"
  DROP COLUMN "taskId",
  ADD COLUMN "scheduleId" UUID NOT NULL;
CREATE UNIQUE INDEX "task_schedule_create_operation_scheduleId_key" ON "task_schedule_create_operation"("scheduleId");
ALTER TABLE "task_schedule_create_operation"
  ADD CONSTRAINT "task_schedule_create_operation_scheduleId_fkey"
  FOREIGN KEY ("scheduleId") REFERENCES "task_schedule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 10. The Run ledger: every row is a Task Schedule Run in the exact shape
-- (the cutover's shape check and identity check guaranteed it), so the
-- series parent and the legacy fields go and the identity is required.
ALTER TABLE "task_schedule_run"
  DROP CONSTRAINT "task_schedule_run_seriesTaskId_fkey",
  DROP CONSTRAINT "task_schedule_run_parent_check",
  DROP CONSTRAINT "task_schedule_run_identity_branch_check",
  DROP CONSTRAINT "task_schedule_run_schedule_shape_check",
  DROP CONSTRAINT "task_schedule_run_source_project_check";
DROP INDEX "task_schedule_run_legacyLinkId_key";
DROP INDEX "task_schedule_run_series_effective_id_idx";
DROP INDEX "task_schedule_run_series_epoch_original_key";
DROP INDEX "task_schedule_run_series_original_id_idx";
DROP INDEX "task_schedule_run_v1_planned_original_key";
ALTER TABLE "task_schedule_run"
  DROP COLUMN "seriesTaskId",
  DROP COLUMN "legacyLinkId",
  DROP COLUMN "scheduleVersion",
  DROP COLUMN "ruleSnapshot",
  DROP COLUMN "sourceAccuracy",
  DROP COLUMN "timeAccuracy",
  ALTER COLUMN "scheduleId" SET NOT NULL,
  ALTER COLUMN "epochId" SET NOT NULL,
  ALTER COLUMN "originalScheduledAt" SET NOT NULL,
  ALTER COLUMN "timezone" SET NOT NULL;
DROP TYPE "CalendarSourceAccuracy";
DROP TYPE "CalendarTimeAccuracy";

CREATE TYPE "CalendarSourceType_new" AS ENUM ('WORKSPACE', 'PROJECT');
ALTER TABLE "task_schedule_run" ALTER COLUMN "sourceType" TYPE "CalendarSourceType_new" USING ("sourceType"::TEXT::"CalendarSourceType_new");
ALTER TYPE "CalendarSourceType" RENAME TO "CalendarSourceType_old";
ALTER TYPE "CalendarSourceType_new" RENAME TO "CalendarSourceType";
DROP TYPE "CalendarSourceType_old";

ALTER TABLE "task_schedule_run"
  ADD CONSTRAINT "task_schedule_run_source_project_check" CHECK (
    ("sourceType" = 'PROJECT' AND "sourceProjectId" IS NOT NULL)
    OR ("sourceType" <> 'PROJECT' AND "sourceProjectId" IS NULL)
  );

-- 11. Task: a Task never repeats; its one start time is runAt.
DROP INDEX "task_status_nextRunAt_idx";
ALTER TABLE "task"
  DROP COLUMN "metadata",
  DROP COLUMN "nextRunAt",
  DROP COLUMN "scheduleRevision";

COMMIT;
