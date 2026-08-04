-- Renamed from 20260804120000 so it no longer shares a timestamp prefix with
-- main's 20260804120000_chat_room_thread_read_state. Statements are idempotent
-- so a preview database that already applied the old name can re-apply this
-- one without failing.
ALTER TABLE "task_payment_claim"
ADD COLUMN IF NOT EXISTS "reviewRequiredAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "task_payment_claim_network_reviewRequiredAt_nextAttemptAt_idx"
ON "task_payment_claim"("network", "reviewRequiredAt", "nextAttemptAt");
