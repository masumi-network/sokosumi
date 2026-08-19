-- Preserve the complete financial correlation for operator actions after the
-- source payment and transaction rows are erased. These are intentionally
-- plain snapshots: foreign keys would either delete the audit or block account
-- deletion. Columns remain nullable because action rows whose source payment
-- was already erased cannot be reconstructed safely.
ALTER TABLE "task_x402_payment_action"
ADD COLUMN IF NOT EXISTS "chargedOrganizationId" TEXT,
ADD COLUMN IF NOT EXISTS "chargeTransactionId" TEXT,
ADD COLUMN IF NOT EXISTS "refundTransactionId" TEXT;

-- Best-effort backfill for surviving source payments. Rows whose payment was
-- already erased stay null and remain distinguishable as legacy evidence.
UPDATE "task_x402_payment_action" AS action
SET
  "chargedOrganizationId" = charge."organizationId",
  "chargeTransactionId" = payment."transactionId",
  "refundTransactionId" = payment."refundTransactionId"
FROM "task_x402_payment" AS payment
INNER JOIN "Transaction" AS charge
  ON charge."id" = payment."transactionId"
WHERE action."paymentId" = payment."id"
  AND (
    action."chargedOrganizationId" IS NULL
    OR action."chargeTransactionId" IS NULL
    OR action."refundTransactionId" IS NULL
  );
