-- Which lever restored a payment's debit (admin review, finding 1).
--
-- `status` cannot answer this: the operator goodwill refund (VERIFIED →
-- REFUNDED) and the operator resolve of a wedged PENDING charge (PENDING →
-- REFUNDED) both land REFUNDED. The admin rollup's headline quality signal and
-- primary sort key is the goodwill-refund count, so counting resolves as
-- goodwill refunds ranks a healthy agent as the worst quality-bleeding endpoint
-- — the same false ranking that was already removed once for automated
-- node-refusal refunds, and one a hostile coworker could drive deliberately by
-- wedging PENDING rows against a competitor's agent.
--
-- An explicit column, not the implicit discriminator that already exists (a
-- goodwill refund's row always came from VERIFIED and so always carries
-- attemptId; a resolve's never does). That invariant is a fact about where
-- finalize happens to write attemptId today, and nothing would tell the next
-- writer that the money metric depends on it.
--
-- Nullable with no default and no backfill: absent means "no refund", and the
-- rollup counts a REFUNDED row of unknown kind as neither goodwill nor resolve
-- rather than guessing. Adding a nullable column with no default does not
-- rewrite the table.
--
-- Timestamped after 20260819190000_task_x402_payment_header_purge_index and
-- idempotent like the table's own migration so a partially applied preview
-- database can re-apply.

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "TaskX402PaymentRefundKind" AS ENUM ('NODE_REFUSAL', 'OPERATOR_GOODWILL', 'OPERATOR_RESOLVE');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- AlterTable
ALTER TABLE "task_x402_payment" ADD COLUMN IF NOT EXISTS "refundKind" "TaskX402PaymentRefundKind";
