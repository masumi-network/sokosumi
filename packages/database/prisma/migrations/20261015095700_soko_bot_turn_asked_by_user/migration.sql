-- `requestedByUserId` on a turn held the teammate who mentioned the bot in
-- chat. The name now belongs to the Requester (ADR 0057), so this column takes
-- the name `askedByUserId`, which the context packet already used for it.
ALTER TABLE "soko_bot_turn" RENAME COLUMN "requestedByUserId" TO "askedByUserId";
ALTER TABLE "soko_bot_turn" RENAME CONSTRAINT "soko_bot_turn_requestedByUserId_fkey" TO "soko_bot_turn_askedByUserId_fkey";
