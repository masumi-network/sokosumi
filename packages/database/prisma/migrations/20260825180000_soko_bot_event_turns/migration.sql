ALTER TYPE "SokoBotTurnSource" ADD VALUE IF NOT EXISTS 'EVENT';
ALTER TABLE "soko_bot_delegation" ADD COLUMN "lastSeenStatus" TEXT;
-- Existing delegations start from the status they produced, so only future changes wake the bot.
UPDATE "soko_bot_delegation" SET "lastSeenStatus" = "outcome" WHERE "lastSeenStatus" IS NULL;
