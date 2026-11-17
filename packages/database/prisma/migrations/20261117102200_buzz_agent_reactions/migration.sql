-- CreateTable
CREATE TABLE "chat_room_agent_reaction" (
  "id" UUID NOT NULL,
  "messageId" UUID NOT NULL,
  "coworkerId" TEXT NOT NULL,
  "emoji" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "chat_room_agent_reaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "chat_room_agent_reaction_messageId_coworkerId_emoji_key" ON "chat_room_agent_reaction"("messageId", "coworkerId", "emoji");

-- CreateIndex
CREATE INDEX "chat_room_agent_reaction_coworkerId_idx" ON "chat_room_agent_reaction"("coworkerId");

-- AddForeignKey
ALTER TABLE "chat_room_agent_reaction" ADD CONSTRAINT "chat_room_agent_reaction_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "chat_room_message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_room_agent_reaction" ADD CONSTRAINT "chat_room_agent_reaction_coworkerId_fkey" FOREIGN KEY ("coworkerId") REFERENCES "coworker"("id") ON DELETE CASCADE ON UPDATE CASCADE;
