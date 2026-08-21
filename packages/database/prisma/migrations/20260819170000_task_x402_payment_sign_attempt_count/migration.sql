-- Bounds node-budget burn from uncapped PENDING re-signs (audit L3): a node
-- stuck returning incomplete-200s leaves the record PENDING, and a coworker
-- retry loop would otherwise re-sign — decrementing node budget — without
-- limit. The counter caps re-sign attempts; past the cap a replay refuses and
-- directs to support, leaving the record PENDING for the reconciler (user
-- funds are always safe, the held charge is refund-safe). Timestamped after
-- 20260819160000_task_x402_payment_header and idempotent like the table's own
-- migration so a partially applied preview database can re-apply.

-- AlterTable
ALTER TABLE "task_x402_payment" ADD COLUMN IF NOT EXISTS "signAttemptCount" INTEGER NOT NULL DEFAULT 0;
