-- AlterTable
ALTER TABLE "chat_room_message" ADD COLUMN "deletedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "chat_room_message_deletedAt_idx" ON "chat_room_message"("deletedAt");
