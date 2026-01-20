-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "expiresAt" TIMESTAMP(3);

-- Set expiresAt to 3 months from now (migration execution time) for existing transactions with positive amounts (topups)
UPDATE "Transaction"
SET "expiresAt" = NOW() + INTERVAL '90 days'
WHERE "amount" > 0 AND "expiresAt" IS NULL;
