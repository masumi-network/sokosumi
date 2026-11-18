-- Sub-tasks (SOKD-279): ordered steps inside a Task, separate from PARENT
-- Task links. A sub-task is a full Task row with a parent and a position.
ALTER TABLE "task" ADD COLUMN "parentTaskId" TEXT;
ALTER TABLE "task" ADD COLUMN "position" DOUBLE PRECISION;

-- NOT VALID: the old Core instance keeps writing Tasks during the deploy, and
-- checking every existing row here would hold the task table's write lock for
-- the whole scan. The new columns are all NULL, so nothing can fail; the
-- check runs in a later migration under a lock that lets writes through.
ALTER TABLE "task" ADD CONSTRAINT "task_parentTaskId_fkey" FOREIGN KEY ("parentTaskId") REFERENCES "task"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;

-- A position orders siblings, so only a sub-task has one.
ALTER TABLE "task" ADD CONSTRAINT "task_subtask_position_check"
  CHECK (("parentTaskId" IS NULL) = ("position" IS NULL)) NOT VALID;

-- A sub-task shares its parent's workspace, project and visibility, keeps
-- its parent for life, and nests at most 5 deep (MAX_SUBTASK_DEPTH in Core).
-- Core writes these values; this trigger only rejects a mismatch, so it does
-- not depend on the order of the other BEFORE triggers on "task".
CREATE FUNCTION task_subtask_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  parent RECORD;
  depth INTEGER;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW."parentTaskId" IS DISTINCT FROM OLD."parentTaskId" THEN
    RAISE EXCEPTION 'task_subtask_parent_immutable' USING ERRCODE = '23514';
  END IF;
  IF NEW."parentTaskId" IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT "workspaceId", "projectId", "visibility", "ownerId"
  INTO parent FROM "task" WHERE "id" = NEW."parentTaskId";

  IF NEW."workspaceId" IS DISTINCT FROM parent."workspaceId"
    OR NEW."projectId" IS DISTINCT FROM parent."projectId"
    OR NEW."visibility" IS DISTINCT FROM parent."visibility" THEN
    RAISE EXCEPTION 'task_subtask_parent_mismatch' USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF parent."visibility" = 'PRIVATE' AND NEW."ownerId" IS DISTINCT FROM parent."ownerId" THEN
      RAISE EXCEPTION 'task_subtask_private_owner' USING ERRCODE = '23514';
    END IF;
    WITH RECURSIVE chain AS (
      SELECT "id", "parentTaskId", 1 AS level FROM "task" WHERE "id" = NEW."parentTaskId"
      UNION ALL
      SELECT t."id", t."parentTaskId", chain.level + 1
      FROM "task" t JOIN chain ON t."id" = chain."parentTaskId"
      WHERE chain.level < 6
    )
    SELECT max(level) INTO depth FROM chain;
    IF depth > 5 THEN
      RAISE EXCEPTION 'task_subtask_too_deep' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER task_subtask_guard
BEFORE INSERT OR UPDATE OF "parentTaskId", "workspaceId", "projectId", "visibility" ON "task"
FOR EACH ROW EXECUTE FUNCTION task_subtask_guard();

-- Moving a Task to another project or workspace moves its sub-tasks with it.
-- The UPDATE names both columns, so each child's own column-list triggers
-- (numbering, aliases, placement, tags) fire, and the change recurses down.
CREATE FUNCTION task_subtask_follow_parent() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "task"
  SET "projectId" = NEW."projectId", "workspaceId" = NEW."workspaceId"
  WHERE "parentTaskId" = NEW."id"
    AND ("projectId" IS DISTINCT FROM NEW."projectId" OR "workspaceId" IS DISTINCT FROM NEW."workspaceId");
  RETURN NULL;
END;
$$;
CREATE TRIGGER task_subtask_follow_parent AFTER UPDATE OF "projectId", "workspaceId" ON "task"
FOR EACH ROW
WHEN (NEW."projectId" IS DISTINCT FROM OLD."projectId" OR NEW."workspaceId" IS DISTINCT FROM OLD."workspaceId")
EXECUTE FUNCTION task_subtask_follow_parent();
