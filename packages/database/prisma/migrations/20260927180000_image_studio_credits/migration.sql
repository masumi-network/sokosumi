-- Image studio generations are charged when they are reserved and refunded when
-- they terminally fail. Both ledger transactions are recorded on the job row.
--
-- Two unique indexes carry the safety properties the application relies on:
--   project_image_job_transactionId_key        -- one debit per job, so a
--     replayed reservation cannot take a second one
--   project_image_job_refundTransactionId_key  -- one refund per job, so a
--     webhook and the cron sweep racing the same failed job cannot both pay it
--     back
--
-- Existing rows keep NULL in all three columns: they were generated before the
-- studio charged for anything, and backfilling a charge onto them would invent
-- a debit that no transaction backs.

-- AlterTable
ALTER TABLE "project_image_job"
  ADD COLUMN "chargedCents" BIGINT,
  ADD COLUMN "transactionId" TEXT,
  ADD COLUMN "refundTransactionId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "project_image_job_transactionId_key" ON "project_image_job"("transactionId");

-- CreateIndex
CREATE UNIQUE INDEX "project_image_job_refundTransactionId_key" ON "project_image_job"("refundTransactionId");

-- AddForeignKey
ALTER TABLE "project_image_job" ADD CONSTRAINT "project_image_job_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_image_job" ADD CONSTRAINT "project_image_job_refundTransactionId_fkey" FOREIGN KEY ("refundTransactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;
