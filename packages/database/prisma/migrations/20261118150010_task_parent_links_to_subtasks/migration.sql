-- SOKD-279: PARENT Task links become sub-tasks. One-time backfill.
--
-- A PARENT link (fromTaskId = parent, toTaskId = child) becomes the child's
-- "parentTaskId" only when all of these hold:
--   - the child has exactly one incoming PARENT link,
--   - neither Task is archived,
--   - the child has no parent yet,
--   - the parent was not a sub-task before this backfill (a parent this
--     backfill just attached is fine, so a chain of links becomes a chain
--     of sub-tasks),
--   - task_subtask_guard (20261118150000_task_subtask_reparent) accepts the
--     write: same workspace, project (both null counts as the same) and
--     visibility, the same Owner under a PRIVATE parent, no cycle, and at
--     most 5 levels deep.
-- Each converted link is deleted. Every other PARENT link becomes RELATES
-- and keeps its direction. The PARENT enum value stays: the old Core
-- instance still writes it during the deploy, and
-- prisma/tests/task-schedule-drop-legacy.sql checks it.
--
-- The whole backfill is one DO statement, so it commits or rolls back as
-- one: a failure part-way through leaves every link as it was. Each link
-- runs in its own BEGIN ... EXCEPTION block, so a link that breaks a rule
-- or raises becomes RELATES without stopping the others.
DO $$
DECLARE
  -- Core places a new sub-task 1 after the last one (newSubtaskPosition).
  position_step CONSTANT DOUBLE PRECISION := 1;
  -- Bounds the walk down the link graph; deeper links run last, by age.
  max_link_depth CONSTANT INTEGER := 64;
  link RECORD;
  parent_row RECORD;
  child_row RECORD;
  next_position DOUBLE PRECISION;
  attached TEXT[] := ARRAY[]::TEXT[];
BEGIN
  -- Top-down: links from root parents first, then their children's links.
  -- Inside a level, links in creation order, so siblings keep that order.
  -- The incoming count is read once here, before any link changes.
  FOR link IN
    WITH RECURSIVE ranked AS (
      SELECT l."id", l."toTaskId", 0 AS depth
      FROM "task_link" l
      WHERE l."type" = 'PARENT'
        AND NOT EXISTS (
          SELECT 1 FROM "task_link" up
          WHERE up."type" = 'PARENT' AND up."toTaskId" = l."fromTaskId"
        )
      UNION ALL
      SELECT l."id", l."toTaskId", ranked.depth + 1
      FROM "task_link" l JOIN ranked ON l."fromTaskId" = ranked."toTaskId"
      WHERE l."type" = 'PARENT' AND ranked.depth < max_link_depth
    )
    SELECT
      l."id",
      l."fromTaskId",
      l."toTaskId",
      (
        SELECT count(*) FROM "task_link" incoming
        WHERE incoming."type" = 'PARENT' AND incoming."toTaskId" = l."toTaskId"
      ) AS incoming_parent_links,
      (SELECT min(ranked.depth) FROM ranked WHERE ranked."id" = l."id") AS depth
    FROM "task_link" l
    WHERE l."type" = 'PARENT'
    ORDER BY depth NULLS LAST, l."createdAt", l."id"
  LOOP
    BEGIN
      -- Lock both Tasks, in id order, before reading them: the old Core can
      -- archive or move them meanwhile.
      PERFORM 1 FROM "task"
      WHERE "id" IN (link."fromTaskId", link."toTaskId")
      ORDER BY "id"
      FOR UPDATE;
      SELECT "id", "parentTaskId", "archivedAt"
      INTO parent_row FROM "task" WHERE "id" = link."fromTaskId";
      SELECT "id", "parentTaskId", "archivedAt"
      INTO child_row FROM "task" WHERE "id" = link."toTaskId";

      IF link.incoming_parent_links <> 1
        OR parent_row."archivedAt" IS NOT NULL
        OR child_row."archivedAt" IS NOT NULL
        OR child_row."parentTaskId" IS NOT NULL
        OR (parent_row."parentTaskId" IS NOT NULL
          AND NOT parent_row."id" = ANY (attached)) THEN
        RAISE EXCEPTION 'task_parent_link_not_convertible';
      END IF;

      SELECT COALESCE(max("position"), 0) + position_step INTO next_position
      FROM "task" WHERE "parentTaskId" = link."fromTaskId";
      -- task_subtask_guard checks the remaining rules on this write.
      UPDATE "task"
      SET "parentTaskId" = link."fromTaskId", "position" = next_position
      WHERE "id" = link."toTaskId";
      DELETE FROM "task_link" WHERE "id" = link."id";
      attached := array_append(attached, link."toTaskId");
    EXCEPTION WHEN OTHERS THEN
      UPDATE "task_link"
      SET "type" = 'RELATES', "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = link."id";
    END;
  END LOOP;
END;
$$;
