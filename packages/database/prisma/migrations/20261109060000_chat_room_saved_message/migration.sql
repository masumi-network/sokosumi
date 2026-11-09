-- CreateTable
CREATE TABLE "chat_room_saved_message" (
    "id" UUID NOT NULL,
    "userId" TEXT NOT NULL,
    "messageId" UUID NOT NULL,
    "savedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_room_saved_message_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "chat_room_saved_message_userId_messageId_key" ON "chat_room_saved_message"("userId", "messageId");

-- CreateIndex
CREATE INDEX "chat_room_saved_message_userId_savedAt_idx" ON "chat_room_saved_message"("userId", "savedAt" DESC);

-- AddForeignKey
ALTER TABLE "chat_room_saved_message" ADD CONSTRAINT "chat_room_saved_message_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_room_saved_message" ADD CONSTRAINT "chat_room_saved_message_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "chat_room_message"("id") ON DELETE CASCADE ON UPDATE CASCADE;
