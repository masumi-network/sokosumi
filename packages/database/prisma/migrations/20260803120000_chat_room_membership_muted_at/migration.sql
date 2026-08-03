-- AlterTable
ALTER TABLE "chat_room_user_member" ADD COLUMN "mutedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "chat_room_user_member_userId_mutedAt_idx" ON "chat_room_user_member"("userId", "mutedAt");
