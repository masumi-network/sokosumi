-- Formerly 20260804125000 (and before that 20260804120000). Re-timestamped after
-- main's 20260805122931_add_coworker_workspace_access so all payment-v2 branch
-- migrations apply after the main tip. Statements are idempotent so a preview
-- database that already applied an older name can re-apply this without failing.
ALTER TABLE "task_payment_claim"
ADD COLUMN IF NOT EXISTS "reviewRequiredAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "task_payment_claim_network_reviewRequiredAt_nextAttemptAt_idx"
ON "task_payment_claim"("network", "reviewRequiredAt", "nextAttemptAt");
