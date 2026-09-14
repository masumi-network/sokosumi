-- Protect ordinary Project deletion while keeping explicit Workspace and
-- account erasure complete and idempotent.

CREATE TABLE "project_deletion_tombstone" (
  "id" UUID NOT NULL,
  "deletedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "workspaceId" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "operationId" UUID NOT NULL,
  "actorUserId" TEXT,

  CONSTRAINT "project_deletion_tombstone_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "project_deletion_tombstone_workspaceId_operationId_key"
  ON "project_deletion_tombstone"("workspaceId", "operationId");
CREATE UNIQUE INDEX "project_deletion_tombstone_workspaceId_projectId_key"
  ON "project_deletion_tombstone"("workspaceId", "projectId");
CREATE INDEX "project_deletion_tombstone_actorUserId_idx"
  ON "project_deletion_tombstone"("actorUserId");

ALTER TABLE "project_deletion_tombstone"
  ADD CONSTRAINT "project_deletion_tombstone_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id")
  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "project_deletion_tombstone_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "user"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- The compatibility rollout guarded only the original beta cohort. Calendar
-- history is now generally available, so every Project needs the same database
-- backstop. Erasure removes these children explicitly before deleting Project.
CREATE OR REPLACE FUNCTION prevent_project_delete_with_calendar_history()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "task" AS task_row
    WHERE task_row."projectId" = OLD.id
      AND task_row."archivedAt" IS NULL
      AND (
        task_row."nextRunAt" IS NOT NULL
        OR task_row.metadata IS NOT NULL
      )
  ) OR EXISTS (
    SELECT 1
    FROM "task" AS task_row
    JOIN "task_schedule_quarantine" AS quarantine
      ON quarantine."taskId" = task_row.id
    WHERE task_row."projectId" = OLD.id
  ) OR EXISTS (
    SELECT 1
    FROM "task_link" AS link
    JOIN "task" AS source_task ON source_task.id = link."fromTaskId"
    JOIN "task" AS target_task ON target_task.id = link."toTaskId"
    WHERE link.type = 'SCHEDULE'
      AND (
        source_task."projectId" = OLD.id
        OR target_task."projectId" = OLD.id
      )
  ) OR EXISTS (
    SELECT 1
    FROM "task_schedule_occurrence" AS occurrence
    WHERE occurrence."sourceProjectId" = OLD.id
  ) OR EXISTS (
    SELECT 1
    FROM "project_close_operation" AS close_operation
    WHERE close_operation."projectId" = OLD.id
  ) OR EXISTS (
    SELECT 1
    FROM "project_event" AS project_event_row
    WHERE project_event_row."projectId" = OLD.id
  ) THEN
    RETURN NULL;
  END IF;

  RETURN OLD;
END;
$$;

-- PostgreSQL runs same-timing triggers alphabetically. The old BEFORE DELETE
-- invalidation could therefore enqueue a false deletion before the guard
-- returned NULL. Publish only after the row was actually deleted.
DROP TRIGGER calendar_project_delete_invalidation ON "project";
CREATE TRIGGER calendar_project_delete_invalidation
AFTER DELETE ON "project"
FOR EACH ROW EXECUTE FUNCTION invalidate_calendar_for_project_change();

-- Calendar outbox rows intentionally have no Workspace FK so row-level
-- mutation triggers never invert parent locks. Explicit Workspace erasure must
-- still remove all pending and published identity-bearing payloads.
CREATE OR REPLACE FUNCTION erase_calendar_outbox_for_workspace_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  DELETE FROM "calendar_invalidation_outbox"
  WHERE "workspaceId" = OLD.id;
  RETURN OLD;
END;
$$;

CREATE TRIGGER calendar_workspace_outbox_erasure
AFTER DELETE ON "workspace"
FOR EACH ROW EXECUTE FUNCTION erase_calendar_outbox_for_workspace_delete();
