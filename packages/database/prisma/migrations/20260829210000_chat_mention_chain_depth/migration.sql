-- Bot-to-bot hop counter. A person speaking resets it; each bot-authored
-- mention inherits its turn's depth plus one, and past the ceiling no mention
-- row is written, so an unattended cascade terminates by construction.
--
-- Existing rows are all human-initiated, so 0 is the correct backfill.
ALTER TABLE "chat_room_mention" ADD COLUMN "chainDepth" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "soko_bot_turn" ADD COLUMN "chainDepth" INTEGER NOT NULL DEFAULT 0;
