-- Expand the scheduler schema for Calendar compatibility. Calendar revision
-- triggers and outbox publishers are intentionally enabled in a later rollout.

CREATE TYPE "CalendarSourceType" AS ENUM ('WORKSPACE', 'PROJECT', 'LEGACY_UNKNOWN');
CREATE TYPE "CalendarSourceAccuracy" AS ENUM ('EXACT', 'INFERRED', 'UNKNOWN');
CREATE TYPE "CalendarTimeAccuracy" AS ENUM ('EXACT', 'APPROXIMATE');
CREATE TYPE "TaskScheduleOccurrenceState" AS ENUM ('PLANNED', 'SKIPPED', 'CANCELED', 'RELEASED');
CREATE TYPE "ProjectCloseOperationState" AS ENUM ('CLOSING', 'CLOSE_FAILED', 'CLOSED');
CREATE TYPE "ProjectEventKind" AS ENUM ('CLOSE_REQUESTED', 'BATCH_FAILED', 'RETRY_REQUESTED', 'SERIES_RESOLVED', 'CLOSE_FINALIZED');
CREATE TYPE "TaskScheduleEventKind" AS ENUM ('CREATED', 'UPDATED', 'REMOVED', 'SOURCE_CHANGED', 'OCCURRENCE_RESCHEDULED', 'OCCURRENCE_SKIPPED', 'OCCURRENCE_RESTORED', 'RELEASED');

ALTER TABLE "workspace"
  ADD COLUMN "calendarRevision" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "project"
  ADD COLUMN "projectRevision" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "calendarRevision" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "closingAt" TIMESTAMP(3),
  ADD COLUMN "closedAt" TIMESTAMP(3);

ALTER TABLE "task"
  ADD COLUMN "scheduleRevision" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "taskEvent"
  ADD COLUMN "scheduleKind" "TaskScheduleEventKind",
  ADD COLUMN "schedulePayload" JSONB,
  ADD COLUMN "scheduleOperationId" UUID;

CREATE UNIQUE INDEX "taskEvent_taskId_scheduleOperationId_key"
  ON "taskEvent"("taskId", "scheduleOperationId")
  WHERE "scheduleOperationId" IS NOT NULL;

CREATE TABLE "task_schedule_occurrence" (
  "id" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "seriesTaskId" TEXT NOT NULL,
  "releasedTaskId" TEXT,
  "epochId" UUID,
  "originalScheduledAt" TIMESTAMP(3),
  "effectiveScheduledAt" TIMESTAMP(3) NOT NULL,
  "legacyLinkId" TEXT,
  "state" "TaskScheduleOccurrenceState" NOT NULL,
  "sourceWorkspaceId" UUID NOT NULL,
  "sourceType" "CalendarSourceType" NOT NULL,
  "sourceProjectId" UUID,
  "sourceAccuracy" "CalendarSourceAccuracy" NOT NULL DEFAULT 'EXACT',
  "timeAccuracy" "CalendarTimeAccuracy" NOT NULL DEFAULT 'EXACT',
  "actorUserId" TEXT,
  "timezone" TEXT,
  "ruleSnapshot" JSONB,

  CONSTRAINT "task_schedule_occurrence_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "task_schedule_occurrence"
  ADD CONSTRAINT "task_schedule_occurrence_source_project_check" CHECK (
    ("sourceType" = 'PROJECT' AND "sourceProjectId" IS NOT NULL)
    OR ("sourceType" <> 'PROJECT' AND "sourceProjectId" IS NULL)
  ),
  ADD CONSTRAINT "task_schedule_occurrence_identity_branch_check" CHECK (
    (
      "legacyLinkId" IS NULL
      AND "epochId" IS NOT NULL
      AND "originalScheduledAt" IS NOT NULL
      AND "timezone" IS NOT NULL
      AND "sourceType" IN ('WORKSPACE', 'PROJECT')
      AND "sourceAccuracy" = 'EXACT'
      AND "timeAccuracy" = 'EXACT'
    )
    OR (
      "legacyLinkId" IS NOT NULL
      AND "timeAccuracy" = 'APPROXIMATE'
      AND (
        ("sourceAccuracy" = 'INFERRED' AND "sourceType" IN ('WORKSPACE', 'PROJECT'))
        OR ("sourceAccuracy" = 'UNKNOWN' AND "sourceType" = 'LEGACY_UNKNOWN')
      )
    )
  ),
  ADD CONSTRAINT "task_schedule_occurrence_released_task_check" CHECK (
    ("state" = 'RELEASED' AND "releasedTaskId" IS NOT NULL)
    OR ("state" <> 'RELEASED' AND "releasedTaskId" IS NULL)
  );

CREATE UNIQUE INDEX "task_schedule_occurrence_releasedTaskId_key" ON "task_schedule_occurrence"("releasedTaskId");
CREATE UNIQUE INDEX "task_schedule_occurrence_legacyLinkId_key" ON "task_schedule_occurrence"("legacyLinkId");
CREATE UNIQUE INDEX "task_schedule_occurrence_series_epoch_original_key" ON "task_schedule_occurrence"("seriesTaskId", "epochId", "originalScheduledAt");
CREATE INDEX "task_schedule_occurrence_series_effective_id_idx" ON "task_schedule_occurrence"("seriesTaskId", "effectiveScheduledAt", "id");
CREATE INDEX "task_schedule_occurrence_series_original_id_idx" ON "task_schedule_occurrence"("seriesTaskId", "originalScheduledAt", "id");
CREATE INDEX "task_schedule_occurrence_workspace_effective_id_idx" ON "task_schedule_occurrence"("sourceWorkspaceId", "effectiveScheduledAt", "id");
CREATE INDEX "task_schedule_occurrence_project_effective_id_idx" ON "task_schedule_occurrence"("sourceProjectId", "effectiveScheduledAt", "id");
CREATE INDEX "task_schedule_occurrence_state_effectiveScheduledAt_id_idx" ON "task_schedule_occurrence"("state", "effectiveScheduledAt", "id");

ALTER TABLE "task_schedule_occurrence" ADD CONSTRAINT "task_schedule_occurrence_seriesTaskId_fkey" FOREIGN KEY ("seriesTaskId") REFERENCES "task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "task_schedule_occurrence" ADD CONSTRAINT "task_schedule_occurrence_releasedTaskId_fkey" FOREIGN KEY ("releasedTaskId") REFERENCES "task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "task_schedule_occurrence" ADD CONSTRAINT "task_schedule_occurrence_sourceWorkspaceId_fkey" FOREIGN KEY ("sourceWorkspaceId") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "task_schedule_occurrence" ADD CONSTRAINT "task_schedule_occurrence_sourceProjectId_fkey" FOREIGN KEY ("sourceProjectId") REFERENCES "project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "project_close_operation" (
  "id" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "projectId" UUID NOT NULL,
  "state" "ProjectCloseOperationState" NOT NULL DEFAULT 'CLOSING',
  "cutoffAt" TIMESTAMP(3) NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "reason" TEXT,
  "seriesCursor" TEXT,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "leaseToken" UUID,
  "leasedAt" TIMESTAMP(3),
  "nextAttemptAt" TIMESTAMP(3),
  "failureSummary" JSONB,
  "completedAt" TIMESTAMP(3),

  CONSTRAINT "project_close_operation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "project_close_operation_projectId_key" ON "project_close_operation"("projectId");
CREATE INDEX "project_close_operation_state_nextAttemptAt_idx" ON "project_close_operation"("state", "nextAttemptAt");
ALTER TABLE "project_close_operation" ADD CONSTRAINT "project_close_operation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "project_event" (
  "id" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "projectId" UUID NOT NULL,
  "closeOperationId" UUID,
  "eventKey" TEXT NOT NULL,
  "kind" "ProjectEventKind" NOT NULL,
  "actorUserId" TEXT,
  "reason" TEXT,
  "payload" JSONB,

  CONSTRAINT "project_event_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "project_event_eventKey_key" ON "project_event"("eventKey");
CREATE INDEX "project_event_projectId_createdAt_id_idx" ON "project_event"("projectId", "createdAt", "id");
CREATE INDEX "project_event_closeOperationId_idx" ON "project_event"("closeOperationId");
ALTER TABLE "project_event" ADD CONSTRAINT "project_event_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_event" ADD CONSTRAINT "project_event_closeOperationId_fkey" FOREIGN KEY ("closeOperationId") REFERENCES "project_close_operation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "calendar_invalidation_outbox" (
  "id" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "workspaceId" UUID NOT NULL,
  "projectId" UUID,
  "dedupeKey" TEXT NOT NULL,
  "calendarRevision" INTEGER NOT NULL,
  "payload" JSONB NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "publishedAt" TIMESTAMP(3),
  "lastError" TEXT,

  CONSTRAINT "calendar_invalidation_outbox_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "calendar_invalidation_outbox_dedupeKey_key" ON "calendar_invalidation_outbox"("dedupeKey");
CREATE INDEX "calendar_invalidation_outbox_publishedAt_nextAttemptAt_idx" ON "calendar_invalidation_outbox"("publishedAt", "nextAttemptAt");
CREATE INDEX "calendar_invalidation_outbox_workspaceId_calendarRevision_idx" ON "calendar_invalidation_outbox"("workspaceId", "calendarRevision");
CREATE INDEX "calendar_invalidation_outbox_projectId_calendarRevision_idx" ON "calendar_invalidation_outbox"("projectId", "calendarRevision");
ALTER TABLE "calendar_invalidation_outbox" ADD CONSTRAINT "calendar_invalidation_outbox_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "calendar_invalidation_outbox" ADD CONSTRAINT "calendar_invalidation_outbox_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Project deletion must not silently turn scheduled work into Workspace work.
-- Malformed JSON is treated as inactive here; migration quarantine owns it.
CREATE OR REPLACE FUNCTION task_schedule_metadata_has_known_shape(value TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  parsed JSONB;
BEGIN
  IF value IS NULL OR value = '' THEN
    RETURN FALSE;
  END IF;

  parsed := value::JSONB;
  RETURN parsed->>'version' IN ('1', '2')
    AND parsed->>'mode' IN ('once', 'recurring');
EXCEPTION WHEN OTHERS THEN
  RETURN FALSE;
END;
$$;

CREATE OR REPLACE FUNCTION prevent_project_delete_with_calendar_history()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Workspace/account erasure reaches Project through an FK cascade after its
  -- owned Tasks and occurrence history are selected for deletion. Preserve that
  -- dedicated purge path; guard only ordinary top-level Project deletes.
  IF pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "task" AS t
    JOIN "user" AS owner ON owner.id = t."ownerId"
    WHERE t."projectId" = OLD.id
      AND t."archivedAt" IS NULL
      AND lower(owner.email) ~ '^[^@]+@nmkr\.io$'
      AND (
        t."nextRunAt" IS NOT NULL
        OR task_schedule_metadata_has_known_shape(t.metadata)
      )
  ) OR EXISTS (
    SELECT 1
    FROM "task_link" AS link
    JOIN "task" AS source_task ON source_task.id = link."fromTaskId"
    JOIN "task" AS target_task ON target_task.id = link."toTaskId"
    JOIN "user" AS owner ON owner.id = source_task."ownerId"
    WHERE link.type = 'SCHEDULE'
      AND lower(owner.email) ~ '^[^@]+@nmkr\.io$'
      AND (
        source_task."projectId" = OLD.id
        OR target_task."projectId" = OLD.id
      )
  ) OR EXISTS (
    SELECT 1
    FROM "task_schedule_occurrence" AS occurrence
    WHERE occurrence."sourceProjectId" = OLD.id
  ) THEN
    RETURN NULL;
  END IF;

  RETURN OLD;
END;
$$;

CREATE TRIGGER project_calendar_history_delete_guard
  BEFORE DELETE ON "project"
  FOR EACH ROW
  EXECUTE FUNCTION prevent_project_delete_with_calendar_history();
