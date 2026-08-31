CREATE TYPE "TaskScheduleQuarantineReason" AS ENUM (
  'INVALID_METADATA',
  'INVALID_TIMEZONE',
  'INVALID_STATUS',
  'NEXT_RUN_MISMATCH'
);

CREATE TABLE "task_schedule_quarantine" (
  "id" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "taskId" TEXT NOT NULL,
  "reason" "TaskScheduleQuarantineReason" NOT NULL,
  "details" TEXT NOT NULL,
  "capturedMetadata" TEXT,
  "capturedNextRunAt" TIMESTAMP(3),
  "capturedStatus" "TaskStatus" NOT NULL,

  CONSTRAINT "task_schedule_quarantine_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "task_schedule_quarantine_taskId_key"
  ON "task_schedule_quarantine"("taskId");
CREATE INDEX "task_schedule_quarantine_createdAt_id_idx"
  ON "task_schedule_quarantine"("createdAt", "id");
CREATE INDEX "task_link_type_createdAt_id_idx"
  ON "task_link"("type", "createdAt", "id");

ALTER TABLE "task_schedule_quarantine"
  ADD CONSTRAINT "task_schedule_quarantine_taskId_fkey"
  FOREIGN KEY ("taskId") REFERENCES "task"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION prevent_project_delete_with_calendar_history()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
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
        OR t.metadata IS NOT NULL
      )
  ) OR EXISTS (
    SELECT 1
    FROM "task" AS t
    JOIN "task_schedule_quarantine" AS quarantine
      ON quarantine."taskId" = t.id
    JOIN "user" AS owner ON owner.id = t."ownerId"
    WHERE t."projectId" = OLD.id
      AND lower(owner.email) ~ '^[^@]+@nmkr\.io$'
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

DROP FUNCTION task_schedule_metadata_has_known_shape(TEXT);
