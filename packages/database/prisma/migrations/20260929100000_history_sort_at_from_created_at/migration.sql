-- history."sortAt" is both the feed's order key and the date the feed renders.
-- It was written from the source row's `updatedAt`, Prisma's `@updatedAt`
-- row-touch column, so any write to a task or a job moved its feed date.
--
-- The task tag classification backfill (20260926141537_task_tags) did exactly
-- that: it walked every historical task, each write fired history_task_sync,
-- and 19,038 TASK rows had their `sortAt` rewritten to that day. A year of work
-- then read as "Yesterday" in every list built on this table, including the
-- Cmd+K palette.
--
-- `createdAt` is immutable, so no future backfill can move a row again, and it
-- is the field the entity's own card already displays (`task-card.tsx`,
-- `TaskMetaDetails`) and — since #5327's task-list fix — the field that surface
-- orders by. IMAGE rows already used `project_image_asset."createdAt"` and are
-- left alone.
--
-- Only the two upsert bodies change. The triggers that call them
-- (history_task_sync, history_task_event_sync, history_job_sync,
-- history_job_event_sync) are unchanged, so new activity still re-derives a row
-- — it just re-derives the same immutable date.

CREATE OR REPLACE FUNCTION upsert_history_task(task_id TEXT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  source_task "task"%ROWTYPE;
BEGIN
  SELECT *
  INTO source_task
  FROM "task"
  WHERE "id" = task_id;

  IF NOT FOUND THEN
    DELETE FROM "history"
    WHERE "kind" = 'TASK'::"HistoryKind"
      AND "entityId" = task_id;
    RETURN;
  END IF;

  INSERT INTO "history" (
    "id",
    "kind",
    "entityId",
    "userId",
    "workspaceId",
    "organizationId",
    "title",
    "description",
    "status",
    "sortAt",
    "amount",
    "projectId",
    "agentId",
    "coworkerId",
    "sokoBotId",
    "bucketSlug",
    "archivedAt"
  )
  VALUES (
    gen_random_uuid()::TEXT,
    'TASK'::"HistoryKind",
    source_task."id",
    source_task."ownerId",
    source_task."workspaceId",
    source_task."organizationId",
    source_task."name",
    source_task."description",
    source_task."status"::TEXT,
    source_task."createdAt",
    history_task_amount(source_task."id"),
    source_task."projectId",
    NULL,
    source_task."assigneeId",
    source_task."assigneeSokoBotId",
    NULL,
    source_task."archivedAt"
  )
  ON CONFLICT ("kind", "entityId") DO UPDATE
  SET
    "userId" = EXCLUDED."userId",
    "workspaceId" = EXCLUDED."workspaceId",
    "organizationId" = EXCLUDED."organizationId",
    "title" = EXCLUDED."title",
    "description" = EXCLUDED."description",
    "status" = EXCLUDED."status",
    "sortAt" = EXCLUDED."sortAt",
    "amount" = EXCLUDED."amount",
    "projectId" = EXCLUDED."projectId",
    "agentId" = EXCLUDED."agentId",
    "coworkerId" = EXCLUDED."coworkerId",
    "sokoBotId" = EXCLUDED."sokoBotId",
    "bucketSlug" = EXCLUDED."bucketSlug",
    "archivedAt" = EXCLUDED."archivedAt";
END;
$$;

CREATE OR REPLACE FUNCTION upsert_history_job(job_id TEXT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  source_job RECORD;
BEGIN
  SELECT j.*, a."name" AS "agentName"
  INTO source_job
  FROM "Job" AS j
  LEFT JOIN "Agent" AS a ON a."id" = j."agentId"
  WHERE j."id" = job_id;

  IF NOT FOUND THEN
    DELETE FROM "history"
    WHERE "kind" = 'JOB'::"HistoryKind"
      AND "entityId" = job_id;
    RETURN;
  END IF;

  INSERT INTO "history" (
    "id",
    "kind",
    "entityId",
    "userId",
    "workspaceId",
    "organizationId",
    "title",
    "description",
    "status",
    "sortAt",
    "amount",
    "projectId",
    "agentId",
    "coworkerId",
    "bucketSlug",
    "archivedAt"
  )
  VALUES (
    gen_random_uuid()::TEXT,
    'JOB'::"HistoryKind",
    source_job."id",
    source_job."ownerId",
    source_job."workspaceId",
    source_job."organizationId",
    COALESCE(source_job."name", source_job."agentName", 'Untitled job'),
    NULL,
    compute_history_job_status(source_job."id"),
    source_job."createdAt",
    history_job_amount(source_job."id"),
    source_job."projectId",
    source_job."agentId",
    NULL,
    NULL,
    NULL
  )
  ON CONFLICT ("kind", "entityId") DO UPDATE
  SET
    "userId" = EXCLUDED."userId",
    "workspaceId" = EXCLUDED."workspaceId",
    "organizationId" = EXCLUDED."organizationId",
    "title" = EXCLUDED."title",
    "description" = EXCLUDED."description",
    "status" = EXCLUDED."status",
    "sortAt" = EXCLUDED."sortAt",
    "amount" = EXCLUDED."amount",
    "projectId" = EXCLUDED."projectId",
    "agentId" = EXCLUDED."agentId",
    "coworkerId" = EXCLUDED."coworkerId",
    "bucketSlug" = EXCLUDED."bucketSlug",
    "archivedAt" = EXCLUDED."archivedAt";
END;
$$;

-- Rebuild the rows already written with a row-touch date. Set-based: mainnet
-- has ~19.7k TASK and ~15.2k JOB rows and a row-by-row loop would fire the
-- triggers again for each one.
UPDATE "history" AS h
SET "sortAt" = t."createdAt"
FROM "task" AS t
WHERE h."kind" = 'TASK'::"HistoryKind"
  AND h."entityId" = t."id"
  AND h."sortAt" IS DISTINCT FROM t."createdAt";

UPDATE "history" AS h
SET "sortAt" = j."createdAt"
FROM "Job" AS j
WHERE h."kind" = 'JOB'::"HistoryKind"
  AND h."entityId" = j."id"
  AND h."sortAt" IS DISTINCT FROM j."createdAt";
