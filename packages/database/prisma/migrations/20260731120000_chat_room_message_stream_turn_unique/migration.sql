-- Durable stream-turn uniqueness for chat room messages (SOK-658).
-- Soft metadata find-then-insert alone races under concurrency; Redis lock is
-- happy-path only. These columns + unique indexes are the DB safety net.

-- AlterTable
ALTER TABLE "chat_room_message" ADD COLUMN "clientMessageId" TEXT;
ALTER TABLE "chat_room_message" ADD COLUMN "responsesApiResponseId" TEXT;

-- Backfill from existing metadata keys (trim empty strings to NULL).
UPDATE "chat_room_message"
SET "clientMessageId" = NULLIF(BTRIM(metadata->>'client_message_id'), '')
WHERE metadata ? 'client_message_id';

UPDATE "chat_room_message"
SET "responsesApiResponseId" = NULLIF(BTRIM(metadata->>'responses_api_response_id'), '')
WHERE metadata ? 'responses_api_response_id';

-- Deduplicate before unique indexes: keep oldest row per (roomId, turn id).
-- Cascades remove dependent reactions/mentions/replies on deleted duplicates.
WITH ranked_client AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY "roomId", "clientMessageId"
      ORDER BY "createdAt" ASC, id ASC
    ) AS rn
  FROM "chat_room_message"
  WHERE "clientMessageId" IS NOT NULL
)
DELETE FROM "chat_room_message"
WHERE id IN (SELECT id FROM ranked_client WHERE rn > 1);

WITH ranked_response AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY "roomId", "responsesApiResponseId"
      ORDER BY "createdAt" ASC, id ASC
    ) AS rn
  FROM "chat_room_message"
  WHERE "responsesApiResponseId" IS NOT NULL
)
DELETE FROM "chat_room_message"
WHERE id IN (SELECT id FROM ranked_response WHERE rn > 1);

-- CreateIndex
CREATE UNIQUE INDEX "chat_room_message_roomId_clientMessageId_key"
  ON "chat_room_message"("roomId", "clientMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "chat_room_message_roomId_responsesApiResponseId_key"
  ON "chat_room_message"("roomId", "responsesApiResponseId");
