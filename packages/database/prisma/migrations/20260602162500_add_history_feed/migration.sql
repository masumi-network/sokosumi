-- History feed read model.
--
-- Trigger coverage matrix:
-- - task INSERT/UPDATE/DELETE: upsert or remove the TASK history row.
-- - taskEvent INSERT/UPDATE/DELETE: recompute TASK credits from linked transactions.
-- - "Job" INSERT/UPDATE/DELETE: upsert or remove the JOB history row.
-- - jobEvent INSERT/UPDATE/DELETE: recompute JOB status from the latest event.
-- - jobPurchase INSERT/UPDATE/DELETE: recompute paid JOB status from on-chain state.
-- - "Transaction" INSERT/UPDATE/DELETE: recompute linked JOB credits and TASK credits.
-- - conversation INSERT/UPDATE/DELETE: upsert or remove the CONVERSATION history row.

CREATE TYPE "HistoryKind" AS ENUM ('TASK', 'JOB', 'CONVERSATION');

CREATE TABLE "history" (
  "id" TEXT NOT NULL,
  "kind" "HistoryKind" NOT NULL,
  "entityId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "workspaceId" UUID,
  "organizationId" TEXT,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "status" TEXT NOT NULL,
  "sortAt" TIMESTAMP(3) NOT NULL,
  "creditsCents" BIGINT,
  "projectId" UUID,
  "agentId" TEXT,
  "coworkerId" TEXT,
  "bucketSlug" TEXT,
  "archivedAt" TIMESTAMP(3),

  CONSTRAINT "history_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "history_kind_entityId_key" ON "history"("kind", "entityId");
CREATE INDEX "history_userId_sortAt_id_idx" ON "history"("userId", "sortAt" DESC, "id" DESC);
CREATE INDEX "history_workspaceId_sortAt_id_idx" ON "history"("workspaceId", "sortAt" DESC, "id" DESC);

CREATE OR REPLACE FUNCTION history_slugify(value TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT NULLIF(
    regexp_replace(
      regexp_replace(lower(btrim(value)), '[^a-z0-9]+', '-', 'g'),
      '(^-+|-+$)',
      '',
      'g'
    ),
    ''
  );
$$;

CREATE OR REPLACE FUNCTION history_bucket_slug_from_metadata(metadata JSONB)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(
    history_slugify(metadata ->> 'coworker_slug'),
    history_slugify(metadata ->> 'coworker_name'),
    history_slugify(metadata ->> 'model_name')
  );
$$;

CREATE OR REPLACE FUNCTION history_task_credits_cents(task_id TEXT)
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
    "creditsCents",
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
    history_task_credits_cents(source_task."id"),
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
    "creditsCents" = EXCLUDED."creditsCents",
    "projectId" = EXCLUDED."projectId",
    "agentId" = EXCLUDED."agentId",
    "coworkerId" = EXCLUDED."coworkerId",
    "bucketSlug" = EXCLUDED."bucketSlug",
    "archivedAt" = EXCLUDED."archivedAt";
END;
$$;

CREATE OR REPLACE FUNCTION history_job_credits_cents(job_id TEXT)
RETURNS BIGINT
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(ABS(t."amount"), 0)::BIGINT
  FROM "Job" AS j
  LEFT JOIN "Transaction" AS t ON t."id" = j."transactionId"
  WHERE j."id" = job_id;
$$;

CREATE OR REPLACE FUNCTION compute_history_job_status(job_id TEXT)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  source_job RECORD;
  latest_status TEXT;
  latest_has_input BOOLEAN;
  payment_deadline TIMESTAMP(3);
BEGIN
  SELECT
    j.*,
    p."onChainStatus"::TEXT AS "onChainStatusText",
    p."nextAction"::TEXT AS "nextActionText"
  INTO source_job
  FROM "Job" AS j
  LEFT JOIN "jobPurchase" AS p ON p."jobId" = j."id"
  WHERE j."id" = job_id;

  IF NOT FOUND THEN
    RETURN 'started';
  END IF;

  SELECT e."status"::TEXT, i."id" IS NOT NULL
  INTO latest_status, latest_has_input
  FROM "jobEvent" AS e
  LEFT JOIN "jobInput" AS i ON i."eventId" = e."id"
  WHERE e."jobId" = job_id
  ORDER BY e."createdAt" DESC, e."id" DESC
  LIMIT 1;

  IF source_job."jobType"::TEXT = 'DEMO' THEN
    RETURN 'completed';
  END IF;

  IF source_job."jobType"::TEXT = 'FREE' THEN
    IF latest_status IS NULL THEN
      RETURN 'started';
    END IF;

    CASE latest_status
      WHEN 'INITIATED' THEN RETURN 'processing';
      WHEN 'AWAITING_PAYMENT' THEN RETURN 'failed';
      WHEN 'AWAITING_INPUT' THEN
        IF latest_has_input THEN
          RETURN 'processing';
        END IF;
        RETURN 'input_required';
      WHEN 'RUNNING' THEN RETURN 'processing';
      WHEN 'COMPLETED' THEN RETURN 'completed';
      WHEN 'FAILED' THEN RETURN 'failed';
      ELSE RETURN 'failed';
    END CASE;
  END IF;

  IF source_job."refundedTransactionId" IS NOT NULL THEN
    RETURN 'refund_resolved';
  END IF;

  IF source_job."onChainStatusText" IS NULL
    AND source_job."nextActionText" IS NULL THEN
    payment_deadline := COALESCE(source_job."payByTime", source_job."createdAt");

    IF payment_deadline < CURRENT_TIMESTAMP - INTERVAL '10 minutes' THEN
      RETURN 'payment_failed';
    END IF;

    RETURN 'payment_pending';
  END IF;

  IF source_job."nextActionText" IN (
    'FUNDS_LOCKING_INITIATED',
    'FUNDS_LOCKING_REQUESTED'
  ) THEN
    RETURN 'payment_pending';
  END IF;

  IF source_job."nextActionText" IN (
    'SET_REFUND_REQUESTED_INITIATED',
    'SET_REFUND_REQUESTED_REQUESTED',
    'UNSET_REFUND_REQUESTED_INITIATED',
    'UNSET_REFUND_REQUESTED_REQUESTED'
  ) THEN
    RETURN 'refund_pending';
  END IF;

  IF latest_status IS NULL THEN
    RETURN 'started';
  END IF;

  IF source_job."onChainStatusText" IS NULL THEN
    RETURN 'payment_pending';
  END IF;

  CASE source_job."onChainStatusText"
    WHEN 'FUNDS_LOCKED' THEN
      CASE latest_status
        WHEN 'INITIATED' THEN RETURN 'payment_pending';
        WHEN 'AWAITING_PAYMENT' THEN RETURN 'payment_pending';
        WHEN 'AWAITING_INPUT' THEN
          IF latest_has_input THEN
            RETURN 'processing';
          END IF;
          RETURN 'input_required';
        WHEN 'COMPLETED' THEN RETURN 'completed';
        WHEN 'FAILED' THEN RETURN 'failed';
        ELSE
          IF source_job."externalDisputeUnlockTime" IS NOT NULL
            AND source_job."externalDisputeUnlockTime" < CURRENT_TIMESTAMP - INTERVAL '10 minutes' THEN
            RETURN 'failed';
          END IF;

          IF source_job."submitResultTime" IS NOT NULL
            AND source_job."submitResultTime" < CURRENT_TIMESTAMP - INTERVAL '10 minutes' THEN
            RETURN 'result_pending';
          END IF;

          RETURN 'processing';
      END CASE;
    WHEN 'RESULT_SUBMITTED' THEN
      IF latest_status = 'COMPLETED' THEN
        RETURN 'completed';
      END IF;
      RETURN 'result_pending';
    WHEN 'FUNDS_WITHDRAWN' THEN
      IF latest_status = 'COMPLETED' THEN
        RETURN 'completed';
      END IF;
      RETURN 'failed';
    WHEN 'FUNDS_OR_DATUM_INVALID' THEN RETURN 'payment_failed';
    WHEN 'REFUND_REQUESTED' THEN RETURN 'refund_pending';
    WHEN 'REFUND_WITHDRAWN' THEN RETURN 'refund_resolved';
    WHEN 'DISPUTED' THEN RETURN 'dispute_pending';
    WHEN 'DISPUTED_WITHDRAWN' THEN RETURN 'dispute_resolved';
    ELSE RETURN 'payment_pending';
  END CASE;
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
    "creditsCents",
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
    history_job_credits_cents(source_job."id"),
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
    "creditsCents" = EXCLUDED."creditsCents",
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
    "creditsCents",
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
    "creditsCents" = EXCLUDED."creditsCents",
    "projectId" = EXCLUDED."projectId",
    "agentId" = EXCLUDED."agentId",
    "coworkerId" = EXCLUDED."coworkerId",
    "bucketSlug" = EXCLUDED."bucketSlug",
    "archivedAt" = EXCLUDED."archivedAt";
END;
$$;

SELECT upsert_history_task("id")
FROM "task"
WHERE "archivedAt" IS NULL;

SELECT upsert_history_job("id")
FROM "Job";

SELECT upsert_history_conversation("id")
FROM "conversation"
WHERE "archivedAt" IS NULL;

CREATE OR REPLACE FUNCTION sync_history_from_task()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM "history"
    WHERE "kind" = 'TASK'::"HistoryKind"
      AND "entityId" = OLD."id";
    RETURN OLD;
  END IF;

  PERFORM upsert_history_task(NEW."id");
  RETURN NEW;
END;
$$;

CREATE TRIGGER history_task_sync
  AFTER INSERT OR UPDATE OR DELETE ON "task"
  FOR EACH ROW
  EXECUTE FUNCTION sync_history_from_task();

CREATE OR REPLACE FUNCTION sync_history_from_task_event()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    PERFORM upsert_history_task(OLD."taskId");
  END IF;

  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    PERFORM upsert_history_task(NEW."taskId");
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER history_task_event_sync
  AFTER INSERT OR UPDATE OR DELETE ON "taskEvent"
  FOR EACH ROW
  EXECUTE FUNCTION sync_history_from_task_event();

CREATE OR REPLACE FUNCTION sync_history_from_job()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM "history"
    WHERE "kind" = 'JOB'::"HistoryKind"
      AND "entityId" = OLD."id";
    RETURN OLD;
  END IF;

  PERFORM upsert_history_job(NEW."id");
  RETURN NEW;
END;
$$;

CREATE TRIGGER history_job_sync
  AFTER INSERT OR UPDATE OR DELETE ON "Job"
  FOR EACH ROW
  EXECUTE FUNCTION sync_history_from_job();

CREATE OR REPLACE FUNCTION sync_history_from_job_event()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    PERFORM upsert_history_job(OLD."jobId");
  END IF;

  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    PERFORM upsert_history_job(NEW."jobId");
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER history_job_event_sync
  AFTER INSERT OR UPDATE OR DELETE ON "jobEvent"
  FOR EACH ROW
  EXECUTE FUNCTION sync_history_from_job_event();

CREATE OR REPLACE FUNCTION sync_history_from_job_purchase()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    PERFORM upsert_history_job(OLD."jobId");
  END IF;

  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    PERFORM upsert_history_job(NEW."jobId");
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER history_job_purchase_sync
  AFTER INSERT OR UPDATE OR DELETE ON "jobPurchase"
  FOR EACH ROW
  EXECUTE FUNCTION sync_history_from_job_purchase();

CREATE OR REPLACE FUNCTION sync_history_from_transaction()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  linked_job_id TEXT;
  linked_task_id TEXT;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    SELECT "id"
    INTO linked_job_id
    FROM "Job"
    WHERE "transactionId" = OLD."id";

    IF linked_job_id IS NOT NULL THEN
      PERFORM upsert_history_job(linked_job_id);
    END IF;

    FOR linked_task_id IN
      SELECT DISTINCT "taskId"
      FROM "taskEvent"
      WHERE "transactionId" = OLD."id"
    LOOP
      PERFORM upsert_history_task(linked_task_id);
    END LOOP;
  END IF;

  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    SELECT "id"
    INTO linked_job_id
    FROM "Job"
    WHERE "transactionId" = NEW."id";

    IF linked_job_id IS NOT NULL THEN
      PERFORM upsert_history_job(linked_job_id);
    END IF;

    FOR linked_task_id IN
      SELECT DISTINCT "taskId"
      FROM "taskEvent"
      WHERE "transactionId" = NEW."id"
    LOOP
      PERFORM upsert_history_task(linked_task_id);
    END LOOP;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER history_transaction_sync
  AFTER INSERT OR UPDATE OR DELETE ON "Transaction"
  FOR EACH ROW
  EXECUTE FUNCTION sync_history_from_transaction();

CREATE OR REPLACE FUNCTION sync_history_from_conversation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM "history"
    WHERE "kind" = 'CONVERSATION'::"HistoryKind"
      AND "entityId" = OLD."id"::TEXT;
    RETURN OLD;
  END IF;

  PERFORM upsert_history_conversation(NEW."id");
  RETURN NEW;
END;
$$;

CREATE TRIGGER history_conversation_sync
  AFTER INSERT OR UPDATE OR DELETE ON "conversation"
  FOR EACH ROW
  EXECUTE FUNCTION sync_history_from_conversation();
