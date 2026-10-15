-- Soko Bot schedules, turns and pending decisions name their Requester, the
-- member who asked (ADR 0056). A pure rename: existing rows keep their value.
ALTER TABLE "soko_bot_schedule" RENAME COLUMN "userId" TO "requestedByUserId";
ALTER TABLE "soko_bot_schedule" RENAME CONSTRAINT "soko_bot_schedule_userId_fkey" TO "soko_bot_schedule_requestedByUserId_fkey";
ALTER INDEX "soko_bot_schedule_userId_createdAt_idx" RENAME TO "soko_bot_schedule_requestedByUserId_createdAt_idx";

ALTER TABLE "soko_bot_turn" RENAME COLUMN "userId" TO "requestedByUserId";
ALTER TABLE "soko_bot_turn" RENAME CONSTRAINT "soko_bot_turn_userId_fkey" TO "soko_bot_turn_requestedByUserId_fkey";
ALTER INDEX "soko_bot_turn_userId_createdAt_idx" RENAME TO "soko_bot_turn_requestedByUserId_createdAt_idx";

ALTER TABLE "soko_bot_pending_decision" RENAME COLUMN "userId" TO "requestedByUserId";
ALTER TABLE "soko_bot_pending_decision" RENAME CONSTRAINT "soko_bot_pending_decision_userId_fkey" TO "soko_bot_pending_decision_requestedByUserId_fkey";
ALTER INDEX "soko_bot_pending_decision_userId_status_createdAt_idx" RENAME TO "soko_bot_pending_decision_requestedByUserId_status_createdA_idx";
