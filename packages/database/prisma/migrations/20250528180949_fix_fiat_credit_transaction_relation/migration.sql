/*
  Warnings:

  - You are about to drop the column `fiatTransactionId` on the `CreditTransaction` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "CreditTransaction_fiatTransactionId_key";

-- AlterTable
ALTER TABLE "CreditTransaction" DROP COLUMN "fiatTransactionId";
