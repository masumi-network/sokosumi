-- CreateTable
CREATE TABLE "chat_channel_read_state" (
  "id" UUID NOT NULL,
  "channelId" UUID NOT NULL,
  "userId" TEXT NOT NULL,
  "lastReadAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "chat_channel_read_state_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "chat_channel_read_state_channelId_userId_key" ON "chat_channel_read_state"("channelId", "userId");

-- CreateIndex
CREATE INDEX "chat_channel_read_state_userId_idx" ON "chat_channel_read_state"("userId");

-- CreateIndex
CREATE INDEX "chat_channel_read_state_channelId_lastReadAt_idx" ON "chat_channel_read_state"("channelId", "lastReadAt");

-- Backfill existing memberships as read so deployment does not convert old history into unread badges.
INSERT INTO "chat_channel_read_state" (
  "id",
  "channelId",
  "userId",
  "lastReadAt",
  "createdAt",
  "updatedAt"
)
SELECT
  gen_random_uuid(),
  member."channelId",
  member."userId",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "chat_channel_user_member" member
ON CONFLICT ("channelId", "userId") DO NOTHING;

-- AddForeignKey
ALTER TABLE "chat_channel_read_state" ADD CONSTRAINT "chat_channel_read_state_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "chat_channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_channel_read_state" ADD CONSTRAINT "chat_channel_read_state_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
