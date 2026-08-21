-- Durable human @mentions on chat room messages (ADR-0012 Participant path).
CREATE TABLE "chat_room_user_mention" (
    "id" UUID NOT NULL,
    "messageId" UUID NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_room_user_mention_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "chat_room_user_mention_messageId_userId_key" ON "chat_room_user_mention"("messageId", "userId");

CREATE INDEX "chat_room_user_mention_userId_idx" ON "chat_room_user_mention"("userId");

CREATE INDEX "chat_room_user_mention_messageId_idx" ON "chat_room_user_mention"("messageId");

ALTER TABLE "chat_room_user_mention" ADD CONSTRAINT "chat_room_user_mention_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "chat_room_message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "chat_room_user_mention" ADD CONSTRAINT "chat_room_user_mention_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill from existing CHAT notifications whose source message still exists.
INSERT INTO "chat_room_user_mention" ("id", "messageId", "userId", "createdAt")
SELECT gen_random_uuid(), m."id", n."userId", n."createdAt"
FROM "notification" n
INNER JOIN "chat_room_message" m ON m."id"::text = n."eventId"
WHERE n."kind" = 'CHAT'
  AND m."deletedAt" IS NULL
ON CONFLICT ("messageId", "userId") DO NOTHING;
