-- CreateTable
CREATE TABLE "chat_room_pinned_message" (
    "id" UUID NOT NULL,
    "roomId" UUID NOT NULL,
    "messageId" UUID NOT NULL,
    "pinnedByUserId" TEXT,
    "pinnedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_room_pinned_message_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "chat_room_pinned_message_roomId_messageId_key" ON "chat_room_pinned_message"("roomId", "messageId");

-- CreateIndex
CREATE INDEX "chat_room_pinned_message_roomId_pinnedAt_idx" ON "chat_room_pinned_message"("roomId", "pinnedAt" DESC);

-- AddForeignKey
ALTER TABLE "chat_room_pinned_message" ADD CONSTRAINT "chat_room_pinned_message_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "chat_room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_room_pinned_message" ADD CONSTRAINT "chat_room_pinned_message_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "chat_room_message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_room_pinned_message" ADD CONSTRAINT "chat_room_pinned_message_pinnedByUserId_fkey" FOREIGN KEY ("pinnedByUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
