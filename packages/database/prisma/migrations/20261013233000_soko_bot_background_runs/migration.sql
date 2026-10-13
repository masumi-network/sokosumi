ALTER TABLE "soko_bot_turn" ADD COLUMN "parentTurnId" UUID,
ADD COLUMN "backgroundTitle" TEXT;

CREATE INDEX "soko_bot_turn_sokoBotId_parentTurnId_status_idx" ON "soko_bot_turn"("sokoBotId", "parentTurnId", "status");

ALTER TABLE "soko_bot_turn" ADD CONSTRAINT "soko_bot_turn_parentTurnId_fkey" FOREIGN KEY ("parentTurnId") REFERENCES "soko_bot_turn"("id") ON DELETE SET NULL ON UPDATE CASCADE;
