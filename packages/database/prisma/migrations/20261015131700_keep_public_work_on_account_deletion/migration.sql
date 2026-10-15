-- Deleting an account keeps the person's public work (ADR 0056). Account
-- deletion deletes the private work they own itself; their public work stays
-- with its workspace, so the Owner no longer takes it down with the person.
--
-- - The Owner column becomes nullable on Task, Task Schedule and Job, and its
--   foreign key empties it instead of cascading. Nothing here clears an Owner
--   and no CHECK ties it to visibility yet; that is the later data move.
-- - The history projection names the responsible person (the Owner, else the
--   person Creator, else the Requester) and may name nobody, so emptying an
--   Owner, Creator or Requester can never fail a deletion. While every row
--   still has an Owner the responsible person is the Owner, so the stored
--   rows are already right and need no backfill.
--
-- Rollback: restore NOT NULL and ON DELETE CASCADE only after every null Owner
-- and history user has been filled in; nothing is dropped here.

-- AlterTable
ALTER TABLE "task" ALTER COLUMN "ownerId" DROP NOT NULL;
ALTER TABLE "task" DROP CONSTRAINT "task_ownerId_fkey";
ALTER TABLE "task" ADD CONSTRAINT "task_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "task_schedule" ALTER COLUMN "ownerId" DROP NOT NULL;
ALTER TABLE "task_schedule" DROP CONSTRAINT "task_schedule_ownerId_fkey";
ALTER TABLE "task_schedule" ADD CONSTRAINT "task_schedule_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "Job" ALTER COLUMN "ownerId" DROP NOT NULL;
ALTER TABLE "Job" DROP CONSTRAINT "Job_ownerId_fkey";
ALTER TABLE "Job" ADD CONSTRAINT "Job_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "history" ALTER COLUMN "userId" DROP NOT NULL;

-- Only the user column of the two upsert bodies changes; everything else is
-- 20260929100000_history_sort_at_from_created_at as it stood.
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
    COALESCE(
      source_task."ownerId",
      source_task."creatorUserId",
      source_task."requestedByUserId"
    ),
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
    COALESCE(
      source_job."ownerId",
      source_job."creatorUserId",
      source_job."requestedByUserId"
    ),
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
