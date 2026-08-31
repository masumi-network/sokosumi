-- Org grant/transfer/refund/sentinel rows stamp organizationId and leave
-- userId null so deleting a historical member cannot cascade the org pot.
-- Spend rows still set userId. Personal grant/spend/refund still set userId.
ALTER TABLE "Transaction" ALTER COLUMN "userId" DROP NOT NULL;

UPDATE "Transaction" AS t
SET "userId" = NULL
FROM "credit_bucket" AS cb
WHERE cb."sourceTransactionId" = t.id
  AND t."organizationId" IS NOT NULL
  AND cb."userId" IS NULL
  AND t."userId" IS NOT NULL;
