-- AlterTable
ALTER TABLE "chat_room_user_member" ADD COLUMN "pinnedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "chat_room_read_state" ADD COLUMN "markedUnreadAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "chat_room_user_member_userId_pinnedAt_idx" ON "chat_room_user_member"("userId", "pinnedAt");
