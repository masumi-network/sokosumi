/*
  Warnings:

  - Made the column `blockchainIdentifier` on table `Job` required. This step will fail if there are existing NULL values in that column.
  - Made the column `submitResultTime` on table `Job` required. This step will fail if there are existing NULL values in that column.
  - Made the column `unlockTime` on table `Job` required. This step will fail if there are existing NULL values in that column.
  - Made the column `externalDisputeUnlockTime` on table `Job` required. This step will fail if there are existing NULL values in that column.
  - Made the column `sellerVkey` on table `Job` required. This step will fail if there are existing NULL values in that column.
  - Made the column `identifierFromPurchaser` on table `Job` required. This step will fail if there are existing NULL values in that column.
  - Made the column `payByTime` on table `Job` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "Job" ALTER COLUMN "blockchainIdentifier" SET NOT NULL,
ALTER COLUMN "submitResultTime" SET NOT NULL,
ALTER COLUMN "unlockTime" SET NOT NULL,
ALTER COLUMN "externalDisputeUnlockTime" SET NOT NULL,
ALTER COLUMN "sellerVkey" SET NOT NULL,
ALTER COLUMN "identifierFromPurchaser" SET NOT NULL,
ALTER COLUMN "payByTime" SET NOT NULL;
