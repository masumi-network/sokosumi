-- ADR 0041: the Calendar shows a Queued Task at its Run at, so setting,
-- moving, or clearing a Run at invalidates it like the other Task fields
-- the Calendar shows. Same function as before, plus "runAt".
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
    calendar_relevant := NEW.metadata IS NOT NULL OR NEW."nextRunAt" IS NOT NULL
      OR NEW."runAt" IS NOT NULL;
  ELSIF TG_OP = 'DELETE' THEN
    task_id := OLD.id;
    old_workspace_id := OLD."workspaceId";
    old_project_id := OLD."projectId";
    calendar_relevant := OLD.metadata IS NOT NULL OR OLD."nextRunAt" IS NOT NULL
      OR OLD."runAt" IS NOT NULL;
  ELSE
    task_id := NEW.id;
    old_workspace_id := OLD."workspaceId";
    new_workspace_id := NEW."workspaceId";
    old_project_id := OLD."projectId";
    new_project_id := NEW."projectId";
    IF ROW(
      OLD."workspaceId", OLD."projectId", OLD."ownerId", OLD.name,
      OLD.status, OLD."assigneeId", OLD."assigneeUserId", OLD."assigneeSokoBotId",
      OLD."scheduleRevision", OLD."nextRunAt", OLD.metadata, OLD."archivedAt",
      OLD."runAt"
    ) IS NOT DISTINCT FROM ROW(
      NEW."workspaceId", NEW."projectId", NEW."ownerId", NEW.name,
      NEW.status, NEW."assigneeId", NEW."assigneeUserId", NEW."assigneeSokoBotId",
      NEW."scheduleRevision", NEW."nextRunAt", NEW.metadata, NEW."archivedAt",
      NEW."runAt"
    ) THEN
      RETURN NEW;
    END IF;
    calendar_relevant :=
      OLD.metadata IS NOT NULL OR OLD."nextRunAt" IS NOT NULL
      OR NEW.metadata IS NOT NULL OR NEW."nextRunAt" IS NOT NULL
      OR OLD."runAt" IS NOT NULL OR NEW."runAt" IS NOT NULL;
  END IF;

  IF NOT calendar_relevant THEN
    SELECT EXISTS (
      SELECT 1
      FROM "task_schedule_occurrence"
      WHERE "seriesTaskId" = task_id OR "releasedTaskId" = task_id
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
