-- Soko Bot participates in chat through a first-party coworker row, and a
-- chat mention can start a turn whose reply lands in the room.
ALTER TABLE "coworker" ADD COLUMN "sokoBotId" UUID;
CREATE UNIQUE INDEX "coworker_sokoBotId_key" ON "coworker"("sokoBotId");
ALTER TABLE "coworker" ADD CONSTRAINT "coworker_sokoBotId_fkey" FOREIGN KEY ("sokoBotId") REFERENCES "orchestrator"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "soko_bot_turn" ADD COLUMN "chatMentionId" UUID;
ALTER TABLE "soko_bot_turn" ADD COLUMN "chatResponseMessageId" UUID;
CREATE UNIQUE INDEX "soko_bot_turn_chatMentionId_key" ON "soko_bot_turn"("chatMentionId");
ALTER TABLE "soko_bot_turn" ADD CONSTRAINT "soko_bot_turn_chatMentionId_fkey" FOREIGN KEY ("chatMentionId") REFERENCES "chat_room_mention"("id") ON DELETE SET NULL ON UPDATE CASCADE;
