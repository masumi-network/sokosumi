-- ADR 0041: the Calendar shows a Task Schedule's planned Runs with the
-- schedule's name, owner, and assignee, and only while it is Active. Changing
-- those leaves the Run rows as they are, so the schedule itself enqueues the
-- invalidation. Release bookkeeping (nextRunAt, releasedCount) is left out:
-- the Run row it releases already does. A delete cascades to the Runs, whose
-- own trigger covers it.
CREATE OR REPLACE FUNCTION invalidate_calendar_for_task_schedule_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF ROW(
    OLD."workspaceId", OLD."projectId", OLD."ownerId", OLD.state,
    OLD.visibility, OLD.name, OLD."assigneeId", OLD."assigneeSokoBotId",
    OLD."assigneeUserId", OLD.revision
  ) IS NOT DISTINCT FROM ROW(
    NEW."workspaceId", NEW."projectId", NEW."ownerId", NEW.state,
    NEW.visibility, NEW.name, NEW."assigneeId", NEW."assigneeSokoBotId",
    NEW."assigneeUserId", NEW.revision
  ) THEN
    RETURN NEW;
  END IF;

  PERFORM enqueue_calendar_invalidation(
    NEW."workspaceId",
    OLD."projectId",
    NEW."projectId",
    jsonb_build_object(
      'kind', 'task_schedule_changed',
      'operation', 'update',
      'scheduleId', NEW.id
    )
  );

  RETURN NEW;
END;
$$;

CREATE TRIGGER calendar_task_schedule_invalidation
AFTER UPDATE ON "task_schedule"
FOR EACH ROW EXECUTE FUNCTION invalidate_calendar_for_task_schedule_change();
