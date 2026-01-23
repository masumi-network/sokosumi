/*
  Warnings:

  - You are about to drop the column `referenceId` on the `Transaction` table. All the data in the column will be lost.
  - You are about to drop the column `referenceType` on the `Transaction` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "credit_bucket" DROP CONSTRAINT "credit_bucket_userId_fkey";

-- DropIndex
DROP INDEX "Transaction_referenceId_referenceType_key";

-- AlterTable
ALTER TABLE "Transaction" DROP COLUMN "referenceId",
DROP COLUMN "referenceType";

-- DropEnum
DROP TYPE "TransactionReferenceType";

-- AddForeignKey
ALTER TABLE "credit_bucket" ADD CONSTRAINT "credit_bucket_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
