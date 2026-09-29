-- Activate Calendar collaboration: exact revision/outbox invalidation, access
-- cleanup, PROJECT notifications, and erasure-safe actor references.

ALTER TYPE "NotificationKind" ADD VALUE 'PROJECT';

-- The durable outbox intentionally has no parent foreign keys. Calendar row
-- triggers run after child rows are locked; checking a Workspace/Project FK at
-- insert time would acquire a parent lock in the opposite order and can
-- deadlock with parent-first application transactions. A Project cascade would
-- also delete the invalidation created by the Project delete trigger.
ALTER TABLE "calendar_invalidation_outbox"
  DROP CONSTRAINT "calendar_invalidation_outbox_workspaceId_fkey",
  DROP CONSTRAINT "calendar_invalidation_outbox_projectId_fkey";

ALTER TABLE "notification"
  ADD COLUMN "workspaceId" UUID,
  ADD COLUMN "organizationId" TEXT;

ALTER TABLE "project_event"
  ADD COLUMN "notificationHandledAt" TIMESTAMP(3);

UPDATE "project_event"
SET "notificationHandledAt" = "createdAt"
WHERE kind = 'CLOSE_FINALIZED'
   OR (kind = 'BATCH_FAILED' AND payload->>'failed' = 'true');

-- Older installations may still contain rows whose users were deleted before
-- notifications had an explicit foreign key.
DELETE FROM "notification" AS notification_row
WHERE NOT EXISTS (
  SELECT 1
  FROM "user"
  WHERE "user".id = notification_row."userId"
);

ALTER TABLE "notification"
  ADD CONSTRAINT "notification_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "user"("id")
  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "notification_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "notification_userId_workspaceId_idx"
  ON "notification"("userId", "workspaceId");

CREATE INDEX "notification_organizationId_userId_idx"
  ON "notification"("organizationId", "userId");

CREATE INDEX "notification_workspaceId_idx"
  ON "notification"("workspaceId");

CREATE INDEX "task_schedule_occurrence_actorUserId_idx"
  ON "task_schedule_occurrence"("actorUserId");

CREATE INDEX "project_close_operation_actorUserId_idx"
  ON "project_close_operation"("actorUserId");

CREATE INDEX "project_event_actorUserId_idx"
  ON "project_event"("actorUserId");

CREATE OR REPLACE FUNCTION scope_notification_to_workspace_membership()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."workspaceId" IS NULL THEN
    IF NEW.kind = 'TASK' THEN
      SELECT "workspaceId" INTO NEW."workspaceId"
      FROM "task"
      WHERE id = NEW."referenceId";
    ELSIF NEW.kind = 'JOB' THEN
      SELECT "workspaceId" INTO NEW."workspaceId"
      FROM "Job"
      WHERE id = NEW."referenceId";
    ELSIF NEW.kind = 'CHAT' THEN
      SELECT "workspace".id INTO NEW."workspaceId"
      FROM "chat_room", "chat_room_user_member", "workspace", "member"
      WHERE "chat_room".id::TEXT = NEW."referenceId"
        AND "chat_room"."organizationId" = "workspace"."organizationId"
        AND "chat_room_user_member"."roomId" = "chat_room".id
        AND "chat_room_user_member"."userId" = NEW."userId"
        AND "chat_room_user_member".access = 'member'
        AND "member"."userId" = NEW."userId"
        AND "member"."organizationId" = "chat_room"."organizationId";
    ELSIF NEW.kind = 'SYSTEM' AND NEW.metadata IS NOT NULL THEN
      BEGIN
        NEW."workspaceId" := (NEW.metadata::JSONB->>'workspaceId')::UUID;
      EXCEPTION WHEN OTHERS THEN
        NEW."workspaceId" := NULL;
      END;
    END IF;

    IF NEW."workspaceId" IS NULL THEN
      NEW."organizationId" := NULL;
      RETURN NEW;
    END IF;
  END IF;

  SELECT "organizationId" INTO NEW."organizationId"
  FROM "workspace"
  WHERE id = NEW."workspaceId";

  RETURN NEW;
END;
$$;

CREATE TRIGGER notification_workspace_membership_scope
BEFORE INSERT OR UPDATE OF "workspaceId", "userId" ON "notification"
FOR EACH ROW EXECUTE FUNCTION scope_notification_to_workspace_membership();

-- Existing notifications predate explicit Workspace scoping. Canonical Task
-- and Job references take precedence; remaining producers already persisted a
-- workspaceId in their JSON metadata.
UPDATE "notification" AS notification_row
SET "workspaceId" = "task"."workspaceId"
FROM "task"
WHERE notification_row.kind = 'TASK'
  AND notification_row."workspaceId" IS NULL
  AND notification_row."referenceId" = "task".id;

UPDATE "notification" AS notification_row
SET "workspaceId" = "job"."workspaceId"
FROM "Job" AS "job"
WHERE notification_row.kind = 'JOB'
  AND notification_row."workspaceId" IS NULL
  AND notification_row."referenceId" = "job".id;

UPDATE "notification" AS notification_row
SET "workspaceId" = "workspace".id
FROM "workspace"
WHERE notification_row."workspaceId" IS NULL
  AND notification_row.kind = 'SYSTEM'
  AND notification_row.metadata IS NOT NULL
  AND pg_input_is_valid(notification_row.metadata, 'jsonb')
  AND notification_row.metadata::JSONB->>'workspaceId' = "workspace".id::TEXT;

-- Host-member CHAT rows can be scoped safely. External guests deliberately
-- remain room-scoped only and must survive host Organization membership loss.
UPDATE "notification" AS notification_row
SET "workspaceId" = "workspace".id
FROM "chat_room", "chat_room_user_member", "workspace", "member"
WHERE notification_row.kind = 'CHAT'
  AND notification_row."workspaceId" IS NULL
  AND notification_row."referenceId" = "chat_room".id::TEXT
  AND "chat_room"."organizationId" = "workspace"."organizationId"
  AND "chat_room_user_member"."roomId" = "chat_room".id
  AND "chat_room_user_member"."userId" = notification_row."userId"
  AND "chat_room_user_member".access = 'member'
  AND "member"."userId" = notification_row."userId"
  AND "member"."organizationId" = "chat_room"."organizationId";

-- Rows whose recipient no longer has access must be gone before the composite
-- membership FK is installed. The same FK rejects future late inserts and
-- cascades every scoped notification when membership is removed.
DELETE FROM "notification" AS notification_row
USING "workspace"
WHERE notification_row."workspaceId" = "workspace".id
  AND "workspace"."userId" IS DISTINCT FROM notification_row."userId"
  AND (
    "workspace"."organizationId" IS NULL
    OR NOT EXISTS (
      SELECT 1
      FROM "member"
      WHERE "member"."userId" = notification_row."userId"
        AND "member"."organizationId" = "workspace"."organizationId"
    )
  );

ALTER TABLE "notification"
  ADD CONSTRAINT "notification_organization_member_fkey"
  FOREIGN KEY ("userId", "organizationId")
  REFERENCES "member"("userId", "organizationId")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "project_close_operation"
  ALTER COLUMN "actorUserId" DROP NOT NULL;

-- Actor references were opaque strings before this migration. Redact stale
-- references before adding erasure-safe foreign keys.
UPDATE "task_schedule_occurrence" AS occurrence
SET "actorUserId" = NULL
WHERE occurrence."actorUserId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "user" WHERE "user".id = occurrence."actorUserId"
  );

UPDATE "project_close_operation" AS close_operation
SET "actorUserId" = NULL
WHERE close_operation."actorUserId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "user" WHERE "user".id = close_operation."actorUserId"
  );

UPDATE "project_event" AS project_event_row
SET "actorUserId" = NULL
WHERE project_event_row."actorUserId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "user" WHERE "user".id = project_event_row."actorUserId"
  );

ALTER TABLE "task_schedule_occurrence"
  ADD CONSTRAINT "task_schedule_occurrence_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "user"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "project_close_operation"
  ADD CONSTRAINT "project_close_operation_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "user"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "project_event"
  ADD CONSTRAINT "project_event_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "user"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE SEQUENCE "calendar_invalidation_revision_seq"
  AS INTEGER
  MINVALUE 1;

CREATE OR REPLACE FUNCTION enqueue_calendar_invalidation(
  target_workspace_id UUID,
  old_project_id UUID,
  new_project_id UUID,
  invalidation_payload JSONB
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  invalidation_id UUID := gen_random_uuid();
  transaction_dedupe_key TEXT;
  project_ids UUID[] := ARRAY(
    SELECT DISTINCT project_id
    FROM unnest(ARRAY[old_project_id, new_project_id]) AS project_id
    WHERE project_id IS NOT NULL
  );
  workspace_revision INTEGER;
BEGIN
  transaction_dedupe_key := txid_current()::TEXT || CASE
    WHEN invalidation_payload->>'kind' = 'calendar_access_revoked'
      THEN ':calendar-revoke:' || target_workspace_id::TEXT || ':' ||
        COALESCE(invalidation_payload->>'userId', invalidation_id::TEXT)
    ELSE ':calendar:' || target_workspace_id::TEXT
  END;

  -- One transaction can touch thousands of occurrence rows. Keep one durable
  -- workspace invalidation and merge the affected Project scopes into it.
  IF invalidation_payload->>'kind' = 'calendar_access_revoked' THEN
    PERFORM 1
    FROM "calendar_invalidation_outbox"
    WHERE "dedupeKey" = transaction_dedupe_key;
    IF FOUND THEN
      RETURN;
    END IF;
  ELSE
    UPDATE "calendar_invalidation_outbox" AS existing
    SET
      "projectId" = NULL,
      payload = existing.payload || jsonb_build_object(
        'kind', 'calendar_changed',
        'projectIds', ARRAY(
          SELECT DISTINCT project_id
          FROM (
            SELECT jsonb_array_elements_text(
              COALESCE(existing.payload->'projectIds', '[]'::JSONB)
            )::UUID AS project_id
            UNION ALL
            SELECT unnest(project_ids)
          ) AS affected_projects
        )
      )
    WHERE existing."dedupeKey" = transaction_dedupe_key;

    IF FOUND THEN
      RETURN;
    END IF;
  END IF;

  PERFORM 1
  FROM "workspace"
  WHERE id = target_workspace_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- A global sequence gives every committed invalidation a monotonic token
  -- without taking parent-row locks after a Task/occurrence row is locked.
  workspace_revision := nextval(
    'calendar_invalidation_revision_seq'
  );

  INSERT INTO "calendar_invalidation_outbox" (
    id,
    "createdAt",
    "workspaceId",
    "projectId",
    "dedupeKey",
    "calendarRevision",
    payload,
    attempts,
    "nextAttemptAt"
  ) VALUES (
    invalidation_id,
    CURRENT_TIMESTAMP,
    target_workspace_id,
    CASE
      WHEN old_project_id IS NOT DISTINCT FROM new_project_id
        THEN new_project_id
      ELSE NULL
    END,
    transaction_dedupe_key,
    workspace_revision,
    invalidation_payload || jsonb_build_object(
      'workspaceId', target_workspace_id,
      'calendarRevision', workspace_revision,
      'projectIds', project_ids
    ),
    0,
    CURRENT_TIMESTAMP
  );
END;
$$;

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
    calendar_relevant := NEW.metadata IS NOT NULL OR NEW."nextRunAt" IS NOT NULL;
  ELSIF TG_OP = 'DELETE' THEN
    task_id := OLD.id;
    old_workspace_id := OLD."workspaceId";
    old_project_id := OLD."projectId";
    calendar_relevant := OLD.metadata IS NOT NULL OR OLD."nextRunAt" IS NOT NULL;
  ELSE
    task_id := NEW.id;
    old_workspace_id := OLD."workspaceId";
    new_workspace_id := NEW."workspaceId";
    old_project_id := OLD."projectId";
    new_project_id := NEW."projectId";
    IF ROW(
      OLD."workspaceId", OLD."projectId", OLD."ownerId", OLD.name,
      OLD.status, OLD."assigneeId", OLD."assigneeUserId", OLD."assigneeSokoBotId",
      OLD."scheduleRevision", OLD."nextRunAt", OLD.metadata, OLD."archivedAt"
    ) IS NOT DISTINCT FROM ROW(
      NEW."workspaceId", NEW."projectId", NEW."ownerId", NEW.name,
      NEW.status, NEW."assigneeId", NEW."assigneeUserId", NEW."assigneeSokoBotId",
      NEW."scheduleRevision", NEW."nextRunAt", NEW.metadata, NEW."archivedAt"
    ) THEN
      RETURN NEW;
    END IF;
    calendar_relevant :=
      OLD.metadata IS NOT NULL OR OLD."nextRunAt" IS NOT NULL
      OR NEW.metadata IS NOT NULL OR NEW."nextRunAt" IS NOT NULL;
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

CREATE TRIGGER calendar_task_invalidation
BEFORE INSERT OR UPDATE OR DELETE ON "task"
FOR EACH ROW EXECUTE FUNCTION invalidate_calendar_for_task_change();

CREATE OR REPLACE FUNCTION invalidate_calendar_for_occurrence_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  workspace_id UUID;
  old_workspace_id UUID;
  new_workspace_id UUID;
  old_project_id UUID;
  new_project_id UUID;
  occurrence_id UUID;
BEGIN
  IF TG_OP = 'UPDATE' AND ROW(
    OLD."seriesTaskId", OLD."releasedTaskId", OLD."scheduleVersion",
    OLD."epochId", OLD."originalScheduledAt", OLD."effectiveScheduledAt",
    OLD.state, OLD."sourceWorkspaceId", OLD."sourceType",
    OLD."sourceProjectId", OLD."sourceAccuracy", OLD."timeAccuracy",
    OLD."actorUserId"
  ) IS NOT DISTINCT FROM ROW(
    NEW."seriesTaskId", NEW."releasedTaskId", NEW."scheduleVersion",
    NEW."epochId", NEW."originalScheduledAt", NEW."effectiveScheduledAt",
    NEW.state, NEW."sourceWorkspaceId", NEW."sourceType",
    NEW."sourceProjectId", NEW."sourceAccuracy", NEW."timeAccuracy",
    NEW."actorUserId"
  ) THEN
    RETURN NEW;
  END IF;

  IF TG_OP <> 'INSERT' THEN
    old_workspace_id := OLD."sourceWorkspaceId";
    old_project_id := OLD."sourceProjectId";
    occurrence_id := OLD.id;
  END IF;
  IF TG_OP <> 'DELETE' THEN
    new_workspace_id := NEW."sourceWorkspaceId";
    new_project_id := NEW."sourceProjectId";
    occurrence_id := NEW.id;
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
          'occurrenceId', occurrence_id
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
          'occurrenceId', occurrence_id
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
        'occurrenceId', occurrence_id
      )
    );
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER calendar_occurrence_invalidation
BEFORE INSERT OR UPDATE OR DELETE ON "task_schedule_occurrence"
FOR EACH ROW EXECUTE FUNCTION invalidate_calendar_for_occurrence_change();

CREATE OR REPLACE FUNCTION invalidate_calendar_for_project_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  workspace_id UUID;
  project_id UUID;
  old_project_id UUID;
  new_project_id UUID;
BEGIN
  IF TG_OP = 'UPDATE' AND ROW(
    OLD.name, OLD.logo, OLD."closingAt", OLD."closedAt"
  ) IS NOT DISTINCT FROM ROW(
    NEW.name, NEW.logo, NEW."closingAt", NEW."closedAt"
  ) THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    workspace_id := OLD."workspaceId";
    project_id := OLD.id;
  ELSIF TG_OP = 'INSERT' THEN
    workspace_id := NEW."workspaceId";
    project_id := NEW.id;
    new_project_id := NEW.id;
  ELSE
    workspace_id := NEW."workspaceId";
    project_id := NEW.id;
    old_project_id := OLD.id;
    new_project_id := NEW.id;
  END IF;

  PERFORM enqueue_calendar_invalidation(
    workspace_id,
    old_project_id,
    new_project_id,
    jsonb_build_object(
      'kind', 'project_changed',
      'operation', lower(TG_OP),
      'projectId', project_id,
      'before', CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE jsonb_build_object(
        'name', OLD.name,
        'logoUrl', OLD.logo,
        'closingAt', OLD."closingAt",
        'closedAt', OLD."closedAt"
      ) END,
      'after', CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE jsonb_build_object(
        'name', NEW.name,
        'logoUrl', NEW.logo,
        'closingAt', NEW."closingAt",
        'closedAt', NEW."closedAt"
      ) END
    )
  );

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER calendar_project_invalidation
AFTER INSERT OR UPDATE ON "project"
FOR EACH ROW EXECUTE FUNCTION invalidate_calendar_for_project_change();

CREATE TRIGGER calendar_project_delete_invalidation
BEFORE DELETE ON "project"
FOR EACH ROW EXECUTE FUNCTION invalidate_calendar_for_project_change();

CREATE OR REPLACE FUNCTION calendar_access_cleanup_on_member_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  organization_workspace_id UUID;
BEGIN
  SELECT id INTO organization_workspace_id
  FROM "workspace"
  WHERE "organizationId" = OLD."organizationId";

  IF organization_workspace_id IS NULL THEN
    RETURN OLD;
  END IF;

  -- Hold the same lock as the publisher across cleanup and the revoke event,
  -- so no stale membership snapshot can fan out after removal commits.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      'calendar-members:' || organization_workspace_id::TEXT,
      0
    )
  );

  DELETE FROM "notification"
  WHERE "userId" = OLD."userId"
    AND "workspaceId" = organization_workspace_id;

  PERFORM enqueue_calendar_invalidation(
    organization_workspace_id,
    NULL,
    NULL,
    jsonb_build_object(
      'kind', 'calendar_access_revoked',
      'userId', OLD."userId",
      'organizationId', OLD."organizationId"
    )
  );

  RETURN OLD;
END;
$$;

CREATE TRIGGER calendar_access_cleanup_member_delete
AFTER DELETE ON "member"
FOR EACH ROW EXECUTE FUNCTION calendar_access_cleanup_on_member_delete();

CREATE OR REPLACE FUNCTION calendar_membership_fence_on_member_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  organization_workspace_id UUID;
BEGIN
  SELECT id INTO organization_workspace_id
  FROM "workspace"
  WHERE "organizationId" = NEW."organizationId";

  IF organization_workspace_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(
      hashtextextended(
        'calendar-members:' || organization_workspace_id::TEXT,
        0
      )
    );
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER calendar_membership_fence_member_insert
AFTER INSERT ON "member"
FOR EACH ROW EXECUTE FUNCTION calendar_membership_fence_on_member_insert();
