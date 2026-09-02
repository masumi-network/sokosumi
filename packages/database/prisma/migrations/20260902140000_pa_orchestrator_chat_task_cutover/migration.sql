-- SOK-933 / SOK-945: PA is an orchestrator in chat and tasks.
-- Expand columns, remap shadow-coworker identities, delete shadows, then
-- tighten CHECKs. Idempotent: a second deploy finds no sokoBotId rows.

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

-- Remap keyed by coworker."sokoBotId"
INSERT INTO "chat_room_orchestrator_member" ("id", "roomId", "orchestratorId", "createdAt")
SELECT gen_random_uuid(), m."roomId", c."sokoBotId", m."createdAt"
FROM "chat_room_coworker_member" m
INNER JOIN "coworker" c ON c.id = m."coworkerId"
WHERE c."sokoBotId" IS NOT NULL
ON CONFLICT ("roomId", "orchestratorId") DO NOTHING;

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

UPDATE "task" t
SET "creatorCoworkerId" = NULL
FROM "coworker" c
WHERE t."creatorCoworkerId" = c.id
  AND c."sokoBotId" IS NOT NULL
  AND t."creatorOrchestratorId" IS NOT NULL;

UPDATE "taskEvent" e
SET
  "orchestratorId" = c."sokoBotId",
  "coworkerId" = NULL
FROM "coworker" c
WHERE e."coworkerId" = c.id
  AND c."sokoBotId" IS NOT NULL
  AND e."orchestratorId" IS NULL;

UPDATE "taskEvent" e
SET "coworkerId" = NULL
FROM "coworker" c
WHERE e."coworkerId" = c.id
  AND c."sokoBotId" IS NOT NULL
  AND e."orchestratorId" IS NOT NULL;

UPDATE "task_file" f
SET "uploadedByCoworkerId" = NULL
FROM "coworker" c
WHERE f."uploadedByCoworkerId" = c.id
  AND c."sokoBotId" IS NOT NULL;

-- coworker:{userId}:{shadowId} → orchestrator:{userId}:{sokoBotId}
UPDATE "chat_room" r
SET "directKey" = 'orchestrator:' || split_part(r."directKey", ':', 2) || ':' || c."sokoBotId"::text
FROM "coworker" c
WHERE r."directKey" = 'coworker:' || split_part(r."directKey", ':', 2) || ':' || c.id
  AND c."sokoBotId" IS NOT NULL
  AND r."directKey" LIKE 'coworker:%:%'
  AND r."directKey" NOT LIKE 'coworker:%:%:%';

-- direct:v2 participant token coworker:{shadowId} → orchestrator:{sokoBotId}
UPDATE "chat_room" r
SET "directKey" = regexp_replace(
  r."directKey",
  'coworker:' || c.id,
  'orchestrator:' || c."sokoBotId"::text
)
FROM "coworker" c
WHERE c."sokoBotId" IS NOT NULL
  AND r."directKey" LIKE 'direct:v2:%'
  AND r."directKey" LIKE '%coworker:' || c.id || '%';

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
