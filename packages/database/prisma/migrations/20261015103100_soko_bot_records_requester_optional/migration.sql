-- A Soko Bot record has no Requester when the bot started it on its own
-- (ADR 0056), and keeps no deleted person: the Requester is emptied instead of
-- the schedule, turn or pending decision being deleted with them.
ALTER TABLE "soko_bot_schedule" ALTER COLUMN "requestedByUserId" DROP NOT NULL;
ALTER TABLE "soko_bot_schedule" DROP CONSTRAINT "soko_bot_schedule_requestedByUserId_fkey";
ALTER TABLE "soko_bot_schedule" ADD CONSTRAINT "soko_bot_schedule_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "soko_bot_turn" ALTER COLUMN "requestedByUserId" DROP NOT NULL;
ALTER TABLE "soko_bot_turn" DROP CONSTRAINT "soko_bot_turn_requestedByUserId_fkey";
ALTER TABLE "soko_bot_turn" ADD CONSTRAINT "soko_bot_turn_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "soko_bot_pending_decision" ALTER COLUMN "requestedByUserId" DROP NOT NULL;
ALTER TABLE "soko_bot_pending_decision" DROP CONSTRAINT "soko_bot_pending_decision_requestedByUserId_fkey";
ALTER TABLE "soko_bot_pending_decision" ADD CONSTRAINT "soko_bot_pending_decision_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
