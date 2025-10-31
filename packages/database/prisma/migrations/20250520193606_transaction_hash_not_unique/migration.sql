/*
  Warnings:

  - You are about to drop the column `onChainTransactionId` on the `Job` table. All the data in the column will be lost.
  - You are about to drop the `OnChainTransaction` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "Job" DROP CONSTRAINT "Job_onChainTransactionId_fkey";

-- DropIndex
DROP INDEX "Job_onChainTransactionId_key";

-- AlterTable
ALTER TABLE "Job" DROP COLUMN "onChainTransactionId",
ADD COLUMN     "onChainTransactionHash" TEXT,
ADD COLUMN     "onChainTransactionStatus" "OnChainTransactionStatus";

-- DropTable
DROP TABLE "OnChainTransaction";
