-- Persist Core-owned OwnerAuthority and durable completed run count on SokoBotSchedule.
ALTER TABLE "soko_bot_schedule" ADD COLUMN "authority" JSONB;
ALTER TABLE "soko_bot_schedule" ADD COLUMN "completedRuns" INTEGER NOT NULL DEFAULT 0;
