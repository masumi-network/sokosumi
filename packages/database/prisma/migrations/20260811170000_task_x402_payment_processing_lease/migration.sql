-- Advisory lease over a record's node /x402/pay round-trip (audit M3). Two
-- same-key requests could otherwise both reach the node: the first refuses
-- (the second consumed the budget), refunds and closes the row FAILED, and
-- the second then returns a real signed authorization against an
-- already-refunded record — credits back, row terminal, and a live EIP-3009
-- authorization Sokosumi signed and threw away. A request that finds a fresh
-- lease is refused with a retryable 409 instead of racing to the node.
--
-- Nullable and self-expiring (honoured only for TASK_X402_SIGN_LEASE_MS), so
-- a crashed holder cannot wedge the idempotency key and nothing has to clear
-- it on the way out. Timestamped after
-- 20260811160000_task_x402_payment_sign_attempt_count and idempotent like the
-- table's own migration so a partially applied preview database can re-apply.

-- AlterTable
ALTER TABLE "task_x402_payment" ADD COLUMN IF NOT EXISTS "processingAt" TIMESTAMP(3);
