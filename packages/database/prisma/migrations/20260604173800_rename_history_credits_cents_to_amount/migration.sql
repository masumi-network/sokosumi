ALTER TABLE "history" RENAME COLUMN "creditsCents" TO "amount";

CREATE OR REPLACE FUNCTION history_task_amount(task_id TEXT)
RETURNS BIGINT
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(SUM(t."amount" * -1), 0)::BIGINT
  FROM "taskEvent" AS e
  JOIN "Transaction" AS t ON t."id" = e."transactionId"
  WHERE e."taskId" = task_id
    AND t."amount" < 0;
$$;

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
    "bucketSlug",
    "archivedAt"
  )
  VALUES (
    gen_random_uuid()::TEXT,
    'TASK'::"HistoryKind",
    source_task."id",
    source_task."userId",
    source_task."workspaceId",
    source_task."organizationId",
    source_task."name",
    source_task."description",
    source_task."status"::TEXT,
    source_task."updatedAt",
    history_task_amount(source_task."id"),
    source_task."projectId",
    NULL,
    source_task."coworkerId",
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
    "bucketSlug" = EXCLUDED."bucketSlug",
    "archivedAt" = EXCLUDED."archivedAt";
END;
$$;

CREATE OR REPLACE FUNCTION history_job_amount(job_id TEXT)
RETURNS BIGINT
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(ABS(t."amount"), 0)::BIGINT
  FROM "Job" AS j
  LEFT JOIN "Transaction" AS t ON t."id" = j."transactionId"
  WHERE j."id" = job_id;
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
    source_job."userId",
    source_job."workspaceId",
    source_job."organizationId",
    COALESCE(source_job."name", source_job."agentName", 'Untitled job'),
    NULL,
    compute_history_job_status(source_job."id"),
    source_job."updatedAt",
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

CREATE OR REPLACE FUNCTION upsert_history_conversation(conversation_id UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  source_conversation "conversation"%ROWTYPE;
BEGIN
  SELECT *
  INTO source_conversation
  FROM "conversation"
  WHERE "id" = conversation_id;

  IF NOT FOUND THEN
    DELETE FROM "history"
    WHERE "kind" = 'CONVERSATION'::"HistoryKind"
      AND "entityId" = conversation_id::TEXT;
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
    'CONVERSATION'::"HistoryKind",
    source_conversation."id"::TEXT,
    source_conversation."userId",
    NULL,
    NULL,
    COALESCE(source_conversation."title", 'Untitled chat'),
    NULL,
    CASE WHEN source_conversation."archivedAt" IS NULL THEN 'active' ELSE 'archived' END,
    source_conversation."updatedAt",
    NULL,
    NULL,
    NULL,
    NULL,
    history_bucket_slug_from_metadata(source_conversation."metadata"::JSONB),
    source_conversation."archivedAt"
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

DROP FUNCTION IF EXISTS history_task_credits_cents(TEXT);
DROP FUNCTION IF EXISTS history_job_credits_cents(TEXT);
