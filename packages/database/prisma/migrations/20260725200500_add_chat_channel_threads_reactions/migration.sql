-- AlterTable
ALTER TABLE "chat_channel_message"
ADD COLUMN "parentMessageId" UUID;

-- CreateTable
CREATE TABLE "chat_channel_reaction" (
  "id" UUID NOT NULL,
  "messageId" UUID NOT NULL,
  "userId" TEXT NOT NULL,
  "emoji" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "chat_channel_reaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "chat_channel_message_channelId_parentMessageId_createdAt_idx" ON "chat_channel_message"("channelId", "parentMessageId", "createdAt");

-- CreateIndex
CREATE INDEX "chat_channel_message_parentMessageId_createdAt_idx" ON "chat_channel_message"("parentMessageId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "chat_channel_reaction_messageId_userId_emoji_key" ON "chat_channel_reaction"("messageId", "userId", "emoji");

-- CreateIndex
CREATE INDEX "chat_channel_reaction_messageId_emoji_idx" ON "chat_channel_reaction"("messageId", "emoji");

-- CreateIndex
CREATE INDEX "chat_channel_reaction_userId_idx" ON "chat_channel_reaction"("userId");

-- AddForeignKey
ALTER TABLE "chat_channel_message" ADD CONSTRAINT "chat_channel_message_parentMessageId_fkey" FOREIGN KEY ("parentMessageId") REFERENCES "chat_channel_message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_channel_reaction" ADD CONSTRAINT "chat_channel_reaction_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "chat_channel_message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_channel_reaction" ADD CONSTRAINT "chat_channel_reaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
