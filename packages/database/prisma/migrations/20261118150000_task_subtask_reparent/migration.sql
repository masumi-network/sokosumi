-- SOKD-279: a sub-task's parent can change. PARENT Task links become
-- sub-tasks (next migration), so a Task can be attached under a parent,
-- moved to another parent, or detached.
--
-- Each statement below takes effect on its own (a Prisma migration file is
-- not one transaction), and the old Core instance keeps writing Tasks while
-- this runs. Every statement leaves the table consistent on its own.

-- A Task is never its own parent. NOT VALID first: adding a constraint holds
-- the task table's write lock, and checking every row under it would block
-- the old Core for the whole scan. VALIDATE at the end takes a lock that lets
-- reads and writes through. No row can fail it: the earlier guard refused a
-- self-parent as a parent mismatch, because the row did not exist yet.
ALTER TABLE "task" ADD CONSTRAINT "task_subtask_not_self_check"
  CHECK ("parentTaskId" <> "id") NOT VALID;

-- Replaces the guard from 20261118140000_task_subtasks. A sub-task still
-- shares its parent's workspace, project and visibility. The parent can now
-- change. When a Task gets a new parent (an INSERT with a parent, or an
-- UPDATE that sets a different non-null parent), the guard also refuses:
--   - a cycle: the new parent is the Task itself or one of its sub-tasks,
--   - a tree deeper than 5 levels (MAX_SUBTASK_DEPTH in Core): the new
--     parent's depth + 1 + the height of the Task's own sub-task tree,
--   - a private parent with another Owner.
-- Core writes the values and checks the same rules first; this trigger is
-- the backstop.
CREATE OR REPLACE FUNCTION task_subtask_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  max_depth CONSTANT INTEGER := 5;
  parent RECORD;
  ancestor_id TEXT;
  -- The number of Tasks from the new parent up to its root: the level this
  -- Task takes under the new parent.
  task_level INTEGER := 0;
  subtree_height INTEGER := 0;
BEGIN
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

  IF TG_OP = 'UPDATE' AND NEW."parentTaskId" IS NOT DISTINCT FROM OLD."parentTaskId" THEN
    RETURN NEW;
  END IF;

  IF parent."visibility" = 'PRIVATE' AND NEW."ownerId" IS DISTINCT FROM parent."ownerId" THEN
    RAISE EXCEPTION 'task_subtask_private_owner' USING ERRCODE = '23514';
  END IF;

  -- Walk up from the new parent. Stored chains are at most max_depth + 1
  -- Tasks long, so the bound stops the walk before it can loop. The cycle
  -- check runs first: the Task itself is never more than max_depth steps up.
  ancestor_id := NEW."parentTaskId";
  WHILE ancestor_id IS NOT NULL LOOP
    IF ancestor_id = NEW."id" THEN
      RAISE EXCEPTION 'task_subtask_cycle' USING ERRCODE = '23514';
    END IF;
    task_level := task_level + 1;
    IF task_level > max_depth THEN
      RAISE EXCEPTION 'task_subtask_too_deep' USING ERRCODE = '23514';
    END IF;
    SELECT "parentTaskId" INTO ancestor_id FROM "task" WHERE "id" = ancestor_id;
  END LOOP;

  -- A new row has no sub-tasks yet. A moved Task brings its whole tree.
  IF TG_OP = 'UPDATE' THEN
    WITH RECURSIVE subtree AS (
      SELECT "id", 0 AS height FROM "task" WHERE "id" = NEW."id"
      UNION ALL
      SELECT t."id", subtree.height + 1
      FROM "task" t JOIN subtree ON t."parentTaskId" = subtree."id"
      WHERE subtree.height < max_depth
    )
    SELECT max(height) INTO subtree_height FROM subtree;
  END IF;

  IF task_level + subtree_height > max_depth THEN
    RAISE EXCEPTION 'task_subtask_too_deep' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

-- Moving a Task to another project or workspace, or changing its visibility,
-- changes its sub-tasks the same way. The UPDATE names each column, so each
-- child's own column-list triggers (numbering, aliases, placement, tags)
-- fire, and the change recurses down.
CREATE OR REPLACE FUNCTION task_subtask_follow_parent() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "task"
  SET "projectId" = NEW."projectId",
    "workspaceId" = NEW."workspaceId",
    "visibility" = NEW."visibility"
  WHERE "parentTaskId" = NEW."id"
    AND ("projectId" IS DISTINCT FROM NEW."projectId"
      OR "workspaceId" IS DISTINCT FROM NEW."workspaceId"
      OR "visibility" IS DISTINCT FROM NEW."visibility");
  RETURN NULL;
END;
$$;

-- OR REPLACE swaps the trigger in one statement, so no Task write runs
-- without it.
CREATE OR REPLACE TRIGGER task_subtask_follow_parent
AFTER UPDATE OF "projectId", "workspaceId", "visibility" ON "task"
FOR EACH ROW
WHEN (NEW."projectId" IS DISTINCT FROM OLD."projectId"
  OR NEW."workspaceId" IS DISTINCT FROM OLD."workspaceId"
  OR NEW."visibility" IS DISTINCT FROM OLD."visibility")
EXECUTE FUNCTION task_subtask_follow_parent();

-- No other trigger needs "parentTaskId" in its column list. A new parent in
-- another project arrives in the same UPDATE as the new "projectId", which
-- fires the numbering, alias, placement and tag triggers by that column. A
-- change of parent alone keeps the project and workspace, so those triggers
-- have nothing to do. The calendar and history triggers fire on every
-- UPDATE. The guard above already lists "parentTaskId".

ALTER TABLE "task" VALIDATE CONSTRAINT "task_subtask_not_self_check";
