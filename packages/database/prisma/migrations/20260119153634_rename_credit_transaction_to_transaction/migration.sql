/*
  Warnings:

  - You are about to rename the `CreditTransaction` table to `Transaction`.
  - You are about to rename the `CreditTransactionReferenceType` enum to `TransactionReferenceType`.
  - You are about to rename the columns `creditTransactionId` and `refundedCreditTransactionId` on the `Job` table.

*/
-- RenameEnum
ALTER TYPE "CreditTransactionReferenceType" RENAME TO "TransactionReferenceType";

-- RenameTable
ALTER TABLE "CreditTransaction" RENAME TO "Transaction";

-- RenameConstraint
ALTER TABLE "Transaction" RENAME CONSTRAINT "CreditTransaction_pkey" TO "Transaction_pkey";

-- RenameForeignKey
ALTER TABLE "Transaction" RENAME CONSTRAINT "CreditTransaction_userId_fkey" TO "Transaction_userId_fkey";

-- RenameForeignKey
ALTER TABLE "Transaction" RENAME CONSTRAINT "CreditTransaction_organizationId_fkey" TO "Transaction_organizationId_fkey";

-- RenameIndex
ALTER INDEX "CreditTransaction_referenceId_referenceType_key" RENAME TO "Transaction_referenceId_referenceType_key";

-- RenameIndex
ALTER INDEX "CreditTransaction_userId_organizationId_idx" RENAME TO "Transaction_userId_organizationId_idx";

-- DropForeignKey
ALTER TABLE "Job" DROP CONSTRAINT "Job_creditTransactionId_fkey";

-- DropForeignKey
ALTER TABLE "Job" DROP CONSTRAINT "Job_refundedCreditTransactionId_fkey";

-- DropIndex
DROP INDEX "Job_creditTransactionId_key";

-- DropIndex
DROP INDEX "Job_refundedCreditTransactionId_key";

-- AlterTable
ALTER TABLE "Job" RENAME COLUMN "creditTransactionId" TO "transactionId";

-- AlterTable
ALTER TABLE "Job" RENAME COLUMN "refundedCreditTransactionId" TO "refundedTransactionId";

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_refundedTransactionId_fkey" FOREIGN KEY ("refundedTransactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE UNIQUE INDEX "Job_transactionId_key" ON "Job"("transactionId");

-- CreateIndex
CREATE UNIQUE INDEX "Job_refundedTransactionId_key" ON "Job"("refundedTransactionId");
