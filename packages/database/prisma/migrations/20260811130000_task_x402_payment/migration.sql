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
    "idempotencyKey" VARCHAR(200) NOT NULL,
    "status" "TaskX402PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "caip2Network" VARCHAR(64) NOT NULL,
    "asset" VARCHAR(128) NOT NULL,
    "amount" TEXT NOT NULL,
    "payTo" TEXT NOT NULL,
    "attemptId" TEXT,
    "failureReason" TEXT,
    "payerAddress" VARCHAR(42),
    "payloadNonce" VARCHAR(66),
    "paymentPayloadHash" TEXT,
    "validBefore" TIMESTAMP(3),
    "taskId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "taskEventId" TEXT,
    "transactionId" TEXT NOT NULL,
    "refundTransactionId" TEXT,

    CONSTRAINT "task_x402_payment_pkey" PRIMARY KEY ("id")
);

-- AlterTable
-- A database that already applied an earlier version of the CREATE TABLE
-- above skips it entirely (IF NOT EXISTS), so every column bound has to be
-- restated here or it never reaches that database. Widening idempotencyKey to
-- VARCHAR(200) inside the CREATE alone left such a database on unbounded TEXT
-- — exactly the btree 2704-byte overflow the bound exists to prevent, since
-- the column sits inside the (taskId, idempotencyKey) unique. Re-running these
-- is a no-op once the types already match; both paths converge on one shape.
ALTER TABLE "task_x402_payment" ALTER COLUMN "idempotencyKey" TYPE VARCHAR(200);
ALTER TABLE "task_x402_payment" ALTER COLUMN "caip2Network" TYPE VARCHAR(64);
ALTER TABLE "task_x402_payment" ALTER COLUMN "asset" TYPE VARCHAR(128);
ALTER TABLE "task_x402_payment" ALTER COLUMN "payerAddress" TYPE VARCHAR(42);
ALTER TABLE "task_x402_payment" ALTER COLUMN "payloadNonce" TYPE VARCHAR(66);

-- CreateIndex
-- The dedupe unique (ticket 003): the node has no idempotency of its own, so
-- this unique must ship in the same change as the table.
CREATE UNIQUE INDEX IF NOT EXISTS "task_x402_payment_taskId_idempotencyKey_key" ON "task_x402_payment"("taskId", "idempotencyKey");

-- CreateIndex
-- EIP-3009 replay protection, mirrored into the database. payloadNonce +
-- payerAddress are that protocol's replay primitive: the token contract's
-- authorizationState mapping guarantees a given (payer, nonce) authorization
-- can be consumed at most once, so two payment rows carrying the same one mean
-- two credit debits behind a single settleable transfer — the second can never
-- land on-chain, and without this nothing notices. Scoped by network+asset
-- because authorizationState is per-token-contract. Partial because a PENDING
-- row has no nonce yet (it is written on the transition to VERIFIED) and many
-- such rows must coexist; a violation therefore fails that transition, leaves
-- the row PENDING, and PENDING is refundable — the right outcome for a
-- provably unsettleable authorization.
CREATE UNIQUE INDEX IF NOT EXISTS "task_x402_payment_nonce_replay_uidx"
  ON "task_x402_payment" ("caip2Network", "asset", "payerAddress", "payloadNonce")
  WHERE "payloadNonce" IS NOT NULL;

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
--
-- The denormalized columns are not decoration: paymentId points at a row that
-- account deletion hard-deletes, so without them the surviving action row is
-- an unresolvable pointer to a dead uuid. Plain columns, never foreign keys —
-- an FK to task/Agent/User/payment would either cascade the audit row away or
-- block account deletion, which is the whole thing this table avoids.
--
-- The denormalized columns are NOT NULL. "Writers MUST populate them" was a
-- doc comment nothing enforced, and a writer omitting one would silently
-- produce an audit row naming an operator who moved real money without saying
-- whose — found only in a dispute. Every one is derivable at write time from a
-- non-nullable source (the payment's own columns, and its mandatory charge
-- Transaction), so the constraint can never reject a legitimate write.
--
-- `reason` is bounded because this table is append-only and deliberately never
-- swept by prepareTasksForUserDeletion: whatever an operator writes here
-- outlives the erasure of every account it mentions. It must stay a short
-- coded rationale, not narrative that could carry third-party personal data
-- past a GDPR Art. 17 request.
CREATE TABLE IF NOT EXISTS "task_x402_payment_action" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paymentId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "cents" BIGINT NOT NULL,
    "amount" TEXT NOT NULL,
    "asset" VARCHAR(128) NOT NULL,
    "caip2Network" VARCHAR(64) NOT NULL,
    "taskId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "chargedUserId" TEXT NOT NULL,

    CONSTRAINT "task_x402_payment_action_pkey" PRIMARY KEY ("id")
);

-- AlterTable
-- A database that already applied the pre-denormalization version of the
-- CREATE TABLE above skips it entirely (IF NOT EXISTS), so add the columns
-- separately too. Added nullable first so the statement is valid whether or
-- not the column already exists; the NOT NULL follows below.
ALTER TABLE "task_x402_payment_action" ADD COLUMN IF NOT EXISTS "cents" BIGINT;
ALTER TABLE "task_x402_payment_action" ADD COLUMN IF NOT EXISTS "amount" TEXT;
ALTER TABLE "task_x402_payment_action" ADD COLUMN IF NOT EXISTS "asset" TEXT;
ALTER TABLE "task_x402_payment_action" ADD COLUMN IF NOT EXISTS "caip2Network" TEXT;
ALTER TABLE "task_x402_payment_action" ADD COLUMN IF NOT EXISTS "taskId" TEXT;
ALTER TABLE "task_x402_payment_action" ADD COLUMN IF NOT EXISTS "agentId" TEXT;
ALTER TABLE "task_x402_payment_action" ADD COLUMN IF NOT EXISTS "chargedUserId" TEXT;

-- AlterTable
-- Same converge discipline for the bounds and the NOT NULLs: restated here so
-- they also reach a database that skipped the CREATE. Safe unconditionally —
-- nothing writes this table yet on any database that can reach this migration,
-- so there is no row to violate a constraint or overflow a bound. Re-running
-- is a no-op once the shape matches.
ALTER TABLE "task_x402_payment_action" ALTER COLUMN "reason" TYPE VARCHAR(500);
ALTER TABLE "task_x402_payment_action" ALTER COLUMN "asset" TYPE VARCHAR(128);
ALTER TABLE "task_x402_payment_action" ALTER COLUMN "caip2Network" TYPE VARCHAR(64);
ALTER TABLE "task_x402_payment_action" ALTER COLUMN "cents" SET NOT NULL;
ALTER TABLE "task_x402_payment_action" ALTER COLUMN "amount" SET NOT NULL;
ALTER TABLE "task_x402_payment_action" ALTER COLUMN "asset" SET NOT NULL;
ALTER TABLE "task_x402_payment_action" ALTER COLUMN "caip2Network" SET NOT NULL;
ALTER TABLE "task_x402_payment_action" ALTER COLUMN "taskId" SET NOT NULL;
ALTER TABLE "task_x402_payment_action" ALTER COLUMN "agentId" SET NOT NULL;
ALTER TABLE "task_x402_payment_action" ALTER COLUMN "chargedUserId" SET NOT NULL;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "task_x402_payment_action_paymentId_createdAt_idx" ON "task_x402_payment_action"("paymentId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "task_x402_payment_action_operatorId_createdAt_idx" ON "task_x402_payment_action"("operatorId", "createdAt");
