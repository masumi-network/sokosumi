-- x402/Bazaar payment record (PR1-SPEC §4). Sibling of task_payment_claim, not
-- a reuse — the escrow claim's state machine (processing lease, retry ladder,
-- blockchainIdentifier) is meaningless here; this record is terminal at sign
-- time. Statements are idempotent so a preview database that partially applied
-- an earlier run can re-apply without failing.

-- CreateEnum
-- VERIFIED is terminal for the automated flow: the node signs the X-PAYMENT
-- header locally and Soko cannot observe settlement until the phased-settlement
-- reconciler (ticket 011 Q3) ships. REFUNDED is reached from PENDING/FAILED
-- auto-refunds or an operator goodwill refund only.
DO $$ BEGIN
  CREATE TYPE "TaskX402PaymentStatus" AS ENUM ('PENDING', 'VERIFIED', 'FAILED', 'REFUNDED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "task_x402_payment" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" "TaskX402PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "caip2Network" TEXT NOT NULL,
    "asset" TEXT NOT NULL,
    "amount" TEXT NOT NULL,
    "payTo" TEXT NOT NULL,
    "attemptId" TEXT,
    "failureReason" TEXT,
    "payerAddress" TEXT,
    "payloadNonce" TEXT,
    "paymentPayloadHash" TEXT,
    "validBefore" TIMESTAMP(3),
    "taskId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "taskEventId" TEXT,
    "transactionId" TEXT NOT NULL,
    "refundTransactionId" TEXT,

    CONSTRAINT "task_x402_payment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- The dedupe unique (ticket 003): the node has no idempotency of its own, so
-- this unique must ship in the same change as the table.
CREATE UNIQUE INDEX IF NOT EXISTS "task_x402_payment_taskId_idempotencyKey_key" ON "task_x402_payment"("taskId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "task_x402_payment_taskEventId_key" ON "task_x402_payment"("taskEventId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "task_x402_payment_transactionId_key" ON "task_x402_payment"("transactionId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "task_x402_payment_refundTransactionId_key" ON "task_x402_payment"("refundTransactionId");

-- CreateIndex
-- Per-endpoint refund aggregation (PR1-SPEC §5).
CREATE INDEX IF NOT EXISTS "task_x402_payment_agentId_status_idx" ON "task_x402_payment"("agentId", "status");

-- CreateIndex
-- Phased-settlement reconciler expiry scan (ticket 011 Q3).
CREATE INDEX IF NOT EXISTS "task_x402_payment_status_validBefore_idx" ON "task_x402_payment"("status", "validBefore");

-- AddForeignKey
-- RESTRICT: a money record must never vanish with its task; account deletion
-- resolves payments first (prepareTasksForUserDeletion).
DO $$ BEGIN
  ALTER TABLE "task_x402_payment" ADD CONSTRAINT "task_x402_payment_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "task"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- AddForeignKey
-- RESTRICT: agentId is the per-endpoint aggregation key; agent rows must not
-- be hard-deleted while payment history exists.
DO $$ BEGIN
  ALTER TABLE "task_x402_payment" ADD CONSTRAINT "task_x402_payment_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "task_x402_payment" ADD CONSTRAINT "task_x402_payment_taskEventId_fkey" FOREIGN KEY ("taskEventId") REFERENCES "taskEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- AddForeignKey
-- RESTRICT: the credit debit stays available for refund/compensation for the
-- record's lifetime.
DO $$ BEGIN
  ALTER TABLE "task_x402_payment" ADD CONSTRAINT "task_x402_payment_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "task_x402_payment" ADD CONSTRAINT "task_x402_payment_refundTransactionId_fkey" FOREIGN KEY ("refundTransactionId") REFERENCES "Transaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Append-only audit trail for operator decisions on task x402 payments.
-- Refund moves money, so operator attribution cannot live in a mutable column
-- on the payment itself.
--
-- Deliberately FK-free. Both referents are erased by ordinary lifecycle work:
-- account deletion hard-deletes terminal payments (see
-- prepareTasksForUserDeletion) and can remove the operator's own User row. A
-- CASCADE would let that erase the financial audit trail, and a RESTRICT would
-- make account deletion fail — so the ids are stored as plain values that
-- outlive both, which is the normal shape for an audit log.
CREATE TABLE IF NOT EXISTS "task_x402_payment_action" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paymentId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,

    CONSTRAINT "task_x402_payment_action_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "task_x402_payment_action_paymentId_createdAt_idx" ON "task_x402_payment_action"("paymentId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "task_x402_payment_action_operatorId_createdAt_idx" ON "task_x402_payment_action"("operatorId", "createdAt");
