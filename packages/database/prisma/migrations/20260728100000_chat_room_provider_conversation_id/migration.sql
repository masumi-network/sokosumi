ALTER TABLE "chat_room" ADD COLUMN "providerConversationId" TEXT;

CREATE UNIQUE INDEX "chat_room_providerConversationId_key"
  ON "chat_room"("providerConversationId")
  WHERE "providerConversationId" IS NOT NULL;
