-- SOK-933 / SOK-945: PA is an orchestrator in chat and tasks.
-- Expand columns, remap shadow-coworker identities, delete shadows, then
-- tighten CHECKs. The transaction makes a failed one-shot cutover retryable.
-- Deployment must drain old Core writes before this migration starts.

BEGIN;

-- Expand: orchestrator room membership
CREATE TABLE "chat_room_orchestrator_member" (
  "id" UUID NOT NULL,
  "roomId" UUID NOT NULL,
  "orchestratorId" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "chat_room_orchestrator_member_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "chat_room_orchestrator_member_roomId_orchestratorId_key"
  ON "chat_room_orchestrator_member"("roomId", "orchestratorId");

CREATE INDEX "chat_room_orchestrator_member_orchestratorId_idx"
  ON "chat_room_orchestrator_member"("orchestratorId");

ALTER TABLE "chat_room_orchestrator_member"
  ADD CONSTRAINT "chat_room_orchestrator_member_roomId_fkey"
  FOREIGN KEY ("roomId") REFERENCES "chat_room"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "chat_room_orchestrator_member"
  ADD CONSTRAINT "chat_room_orchestrator_member_orchestratorId_fkey"
  FOREIGN KEY ("orchestratorId") REFERENCES "orchestrator"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Expand: message sender
ALTER TABLE "chat_room_message"
  ADD COLUMN "senderOrchestratorId" UUID;

CREATE INDEX "chat_room_message_senderOrchestratorId_idx"
  ON "chat_room_message"("senderOrchestratorId");

ALTER TABLE "chat_room_message"
  ADD CONSTRAINT "chat_room_message_senderOrchestratorId_fkey"
  FOREIGN KEY ("senderOrchestratorId") REFERENCES "orchestrator"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Expand: mention target (coworkerId becomes nullable)
ALTER TABLE "chat_room_mention"
  ADD COLUMN "orchestratorId" UUID;

ALTER TABLE "chat_room_mention"
  ALTER COLUMN "coworkerId" DROP NOT NULL;

CREATE UNIQUE INDEX "chat_room_mention_messageId_orchestratorId_key"
  ON "chat_room_mention"("messageId", "orchestratorId");

CREATE INDEX "chat_room_mention_orchestratorId_status_idx"
  ON "chat_room_mention"("orchestratorId", "status");

ALTER TABLE "chat_room_mention"
  ADD CONSTRAINT "chat_room_mention_orchestratorId_fkey"
  FOREIGN KEY ("orchestratorId") REFERENCES "orchestrator"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Expand: task assignee
ALTER TABLE "task"
  ADD COLUMN "assigneeOrchestratorId" UUID;

CREATE INDEX "task_assigneeOrchestratorId_idx"
  ON "task"("assigneeOrchestratorId");

ALTER TABLE "task"
  ADD CONSTRAINT "task_assigneeOrchestratorId_fkey"
  FOREIGN KEY ("assigneeOrchestratorId") REFERENCES "orchestrator"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Expand: task-file uploader
ALTER TABLE "task_file"
  ADD COLUMN "uploadedByOrchestratorId" UUID;

CREATE INDEX "task_file_uploadedByOrchestratorId_idx"
  ON "task_file"("uploadedByOrchestratorId");

ALTER TABLE "task_file"
  ADD CONSTRAINT "task_file_uploadedByOrchestratorId_fkey"
  FOREIGN KEY ("uploadedByOrchestratorId") REFERENCES "orchestrator"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Expand: history attribution. History is deliberately FK-free.
ALTER TABLE "history"
  ADD COLUMN "orchestratorId" UUID;

CREATE INDEX "history_orchestratorId_idx"
  ON "history"("orchestratorId");

-- Expand: API-key owner
ALTER TABLE "coworker_api_key"
  ADD COLUMN "orchestratorId" UUID;

ALTER TABLE "coworker_api_key"
  ALTER COLUMN "coworkerId" DROP NOT NULL;

CREATE INDEX "coworker_api_key_orchestratorId_idx"
  ON "coworker_api_key"("orchestratorId");

ALTER TABLE "coworker_api_key"
  ADD CONSTRAINT "coworker_api_key_orchestratorId_fkey"
  FOREIGN KEY ("orchestratorId") REFERENCES "orchestrator"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Keep the denormalized task history row aligned with both assignee kinds.
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
    "orchestratorId",
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
    source_task."updatedAt",
    history_task_amount(source_task."id"),
    source_task."projectId",
    NULL,
    source_task."assigneeId",
    source_task."assigneeOrchestratorId",
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
    "orchestratorId" = EXCLUDED."orchestratorId",
    "bucketSlug" = EXCLUDED."bucketSlug",
    "archivedAt" = EXCLUDED."archivedAt";
END;
$$;

-- Remap keyed by coworker."sokoBotId"
INSERT INTO "chat_room_orchestrator_member" ("id", "roomId", "orchestratorId", "createdAt")
SELECT gen_random_uuid(), m."roomId", c."sokoBotId", m."createdAt"
FROM "chat_room_coworker_member" m
INNER JOIN "coworker" c ON c.id = m."coworkerId"
WHERE c."sokoBotId" IS NOT NULL
ON CONFLICT ("roomId", "orchestratorId") DO UPDATE
SET "createdAt" = LEAST(
  "chat_room_orchestrator_member"."createdAt",
  EXCLUDED."createdAt"
);

DELETE FROM "chat_room_coworker_member" m
USING "coworker" c
WHERE m."coworkerId" = c.id
  AND c."sokoBotId" IS NOT NULL;

UPDATE "chat_room_message" msg
SET
  "senderOrchestratorId" = c."sokoBotId",
  "senderCoworkerId" = NULL
FROM "coworker" c
WHERE msg."senderCoworkerId" = c.id
  AND c."sokoBotId" IS NOT NULL;

UPDATE "chat_room_mention" mention
SET
  "orchestratorId" = c."sokoBotId",
  "coworkerId" = NULL
FROM "coworker" c
WHERE mention."coworkerId" = c.id
  AND c."sokoBotId" IS NOT NULL;

UPDATE "task" t
SET
  "assigneeOrchestratorId" = c."sokoBotId",
  "assigneeId" = NULL
FROM "coworker" c
WHERE t."assigneeId" = c.id
  AND c."sokoBotId" IS NOT NULL;

-- Creator Restrict would block shadow delete. Swap onto the bot when unset.
UPDATE "task" t
SET
  "creatorOrchestratorId" = c."sokoBotId",
  "creatorCoworkerId" = NULL
FROM "coworker" c
WHERE t."creatorCoworkerId" = c.id
  AND c."sokoBotId" IS NOT NULL
  AND t."creatorOrchestratorId" IS NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "taskEvent" e
    INNER JOIN "coworker" c ON c.id = e."coworkerId"
    WHERE c."sokoBotId" IS NOT NULL
      AND e."orchestratorId" IS NOT NULL
      AND e."orchestratorId" <> c."sokoBotId"
  ) THEN
    RAISE EXCEPTION
      'SOK-945: task event has conflicting PA coworker and orchestrator attribution';
  END IF;
END $$;

UPDATE "taskEvent" e
SET
  "orchestratorId" = c."sokoBotId",
  "coworkerId" = NULL
FROM "coworker" c
WHERE e."coworkerId" = c.id
  AND c."sokoBotId" IS NOT NULL;

UPDATE "task_file" f
SET
  "uploadedByOrchestratorId" = c."sokoBotId",
  "uploadedByCoworkerId" = NULL
FROM "coworker" c
WHERE f."uploadedByCoworkerId" = c.id
  AND c."sokoBotId" IS NOT NULL;

UPDATE "history" h
SET
  "orchestratorId" = c."sokoBotId",
  "coworkerId" = NULL
FROM "coworker" c
WHERE h."coworkerId" = c.id
  AND c."sokoBotId" IS NOT NULL;

UPDATE "coworker_api_key" key
SET
  "orchestratorId" = c."sokoBotId",
  "coworkerId" = NULL
FROM "coworker" c
WHERE key."coworkerId" = c.id
  AND c."sokoBotId" IS NOT NULL;

INSERT INTO "orchestrator_usage" (
  "id",
  "createdAt",
  "updatedAt",
  "idempotencyKey",
  "referenceId",
  "orchestratorId",
  "userId",
  "organizationId",
  "cents",
  "transactionId"
)
SELECT
  gen_random_uuid(),
  usage."createdAt",
  usage."updatedAt",
  usage."idempotencyKey",
  usage."referenceId",
  c."sokoBotId",
  usage."userId",
  usage."organizationId",
  usage."cents",
  usage."transactionId"
FROM "coworker_usage" usage
INNER JOIN "coworker" c ON c.id = usage."coworkerId"
WHERE c."sokoBotId" IS NOT NULL;

DELETE FROM "coworker_usage" usage
USING "coworker" c
WHERE usage."coworkerId" = c.id
  AND c."sokoBotId" IS NOT NULL;

-- PA assignments and workspace grants are obsolete: orchestrators are fixed to
-- the owner and workspace stored on the orchestrator row.
DELETE FROM "coworker_assignment" assignment
USING "coworker" c
WHERE assignment."coworkerId" = c.id
  AND c."sokoBotId" IS NOT NULL;

DELETE FROM "notification" notification
USING "coworker_workspace_access" access, "coworker" c
WHERE notification."referenceId" = access.id::text
  AND notification."kind" = 'SYSTEM'::"NotificationKind"
  AND notification."messageKey" = 'notifications.coworkerAccess.pending'
  AND access."coworkerId" = c.id
  AND c."sokoBotId" IS NOT NULL;

DELETE FROM "coworker_workspace_access" access
USING "coworker" c
WHERE access."coworkerId" = c.id
  AND c."sokoBotId" IS NOT NULL;

-- coworker:{userId}:{shadowId} → orchestrator:{userId}:{sokoBotId}
UPDATE "chat_room" r
SET "directKey" = 'orchestrator:' || split_part(r."directKey", ':', 2) || ':' || c."sokoBotId"::text
FROM "coworker" c
WHERE r."directKey" = 'coworker:' || split_part(r."directKey", ':', 2) || ':' || c.id
  AND c."sokoBotId" IS NOT NULL
  AND r."directKey" LIKE 'coworker:%:%'
  AND r."directKey" NOT LIKE 'coworker:%:%:%';

-- Replace every PA participant in direct:v2 rooms, then restore the canonical
-- lexicographic participant order used when direct keys are created.
WITH participants AS (
  SELECT
    r.id AS "roomId",
    CASE
      WHEN tokens.values[position] = 'coworker'
        AND c."sokoBotId" IS NOT NULL
      THEN 'orchestrator:' || c."sokoBotId"::text
      ELSE tokens.values[position] || ':' || tokens.values[position + 1]
    END AS participant
  FROM "chat_room" r
  CROSS JOIN LATERAL (
    SELECT string_to_array(
      substring(r."directKey" FROM length('direct:v2:') + 1),
      ':'
    ) AS values
  ) tokens
  CROSS JOIN LATERAL generate_series(
    1,
    array_length(tokens.values, 1),
    2
  ) AS part(position)
  LEFT JOIN "coworker" c
    ON tokens.values[position] = 'coworker'
    AND c.id = tokens.values[position + 1]
  WHERE r."directKey" LIKE 'direct:v2:%'
), rebuilt_directs AS (
  SELECT
    "roomId",
    'direct:v2:' || string_agg(DISTINCT participant, ':' ORDER BY participant)
      AS "directKey"
  FROM participants
  GROUP BY "roomId"
)
UPDATE "chat_room" r
SET "directKey" = rebuilt."directKey"
FROM rebuilt_directs rebuilt
WHERE r.id = rebuilt."roomId"
  AND r."directKey" IS DISTINCT FROM rebuilt."directKey";

DELETE FROM "coworker"
WHERE "sokoBotId" IS NOT NULL;

DO $$
DECLARE
  leftover integer;
BEGIN
  SELECT COUNT(*)::integer INTO leftover
  FROM "coworker"
  WHERE "sokoBotId" IS NOT NULL;

  IF leftover > 0 THEN
    RAISE EXCEPTION
      'SOK-945: % coworker row(s) still have sokoBotId after PA shadow delete',
      leftover;
  END IF;
END $$;

ALTER TABLE "chat_room_message" DROP CONSTRAINT "chat_room_message_sender_check";

ALTER TABLE "chat_room_message"
  ADD CONSTRAINT "chat_room_message_sender_check" CHECK (
    (CASE WHEN "senderUserId" IS NULL THEN 0 ELSE 1 END)
    + (CASE WHEN "senderCoworkerId" IS NULL THEN 0 ELSE 1 END)
    + (CASE WHEN "senderOrchestratorId" IS NULL THEN 0 ELSE 1 END)
    <= 1
  );

ALTER TABLE "chat_room_mention"
  ADD CONSTRAINT "chat_room_mention_target_xor_check" CHECK (
    ("coworkerId" IS NOT NULL AND "orchestratorId" IS NULL)
    OR
    ("coworkerId" IS NULL AND "orchestratorId" IS NOT NULL)
  );

ALTER TABLE "task"
  ADD CONSTRAINT "task_assignee_xor_check" CHECK (
    "assigneeId" IS NULL OR "assigneeOrchestratorId" IS NULL
  );

ALTER TABLE "coworker_api_key"
  ADD CONSTRAINT "coworker_api_key_owner_xor_check" CHECK (
    ("coworkerId" IS NOT NULL AND "orchestratorId" IS NULL)
    OR
    ("coworkerId" IS NULL AND "orchestratorId" IS NOT NULL)
  );

COMMIT;
