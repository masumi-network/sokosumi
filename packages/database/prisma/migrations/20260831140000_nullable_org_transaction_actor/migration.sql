-- Org grant/transfer/refund/sentinel rows stamp organizationId and leave
-- userId null so deleting a historical member cannot cascade the org pot.
-- Spend rows still set userId. Personal grant/spend/refund still set userId.
ALTER TABLE "Transaction" ALTER COLUMN "userId" DROP NOT NULL;

-- Source transactions of org-owned buckets (grants/refunds that create the pot).
UPDATE "Transaction" AS t
SET "userId" = NULL
FROM "credit_bucket" AS cb
WHERE cb."sourceTransactionId" = t.id
  AND t."organizationId" IS NOT NULL
  AND cb."userId" IS NULL
  AND t."userId" IS NOT NULL;

-- Negative txs that drained leftover member: period buckets (transfer +
-- sentinel drains). Leaving a member actor lets user delete undo the drain
-- via CreditConsumption cascade while CreditBucket.userId SetNulls into
-- org shared scope, doubling spendable balance beside the migrated pool.
UPDATE "Transaction" AS t
SET "userId" = NULL
WHERE t."organizationId" IS NOT NULL
  AND t."userId" IS NOT NULL
  AND t.amount < 0
  AND EXISTS (
    SELECT 1
    FROM "credit_consumption" AS cc
    INNER JOIN "credit_bucket" AS cb ON cb.id = cc."bucketId"
    WHERE cc."transactionId" = t.id
      AND cb."referenceType" = 'STRIPE_SUBSCRIPTION_PERIOD'
      AND cb."referenceId" LIKE 'member:%'
  );
