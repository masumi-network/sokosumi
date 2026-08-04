-- CreateTable
CREATE TABLE "chat_room_thread_read_state" (
    "id" UUID NOT NULL,
    "userId" TEXT NOT NULL,
    "parentMessageId" UUID NOT NULL,
    "lastReadAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chat_room_thread_read_state_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "chat_room_thread_read_state_parentMessageId_idx" ON "chat_room_thread_read_state"("parentMessageId");

-- CreateIndex
CREATE INDEX "chat_room_thread_read_state_userId_idx" ON "chat_room_thread_read_state"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "chat_room_thread_read_state_userId_parentMessageId_key" ON "chat_room_thread_read_state"("userId", "parentMessageId");

-- AddForeignKey
ALTER TABLE "chat_room_thread_read_state" ADD CONSTRAINT "chat_room_thread_read_state_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_room_thread_read_state" ADD CONSTRAINT "chat_room_thread_read_state_parentMessageId_fkey" FOREIGN KEY ("parentMessageId") REFERENCES "chat_room_message"("id") ON DELETE CASCADE ON UPDATE CASCADE;
