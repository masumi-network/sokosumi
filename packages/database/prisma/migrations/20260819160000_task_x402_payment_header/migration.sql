-- Stores the signed X-PAYMENT header on the x402 payment record at VERIFIED,
-- so an idempotent replay of the same (taskId, idempotencyKey) can return the
-- stored result verbatim (PR1-SPEC §3.2). Without it a replay would have to
-- re-sign, which reserves a new node attempt and burns budget — the node has
-- no idempotency of its own (ticket 011 Q2). Idempotent like the table's own
-- migration so a partially applied preview database can re-apply.

-- AlterTable
ALTER TABLE "task_x402_payment" ADD COLUMN IF NOT EXISTS "xPaymentHeader" TEXT;
