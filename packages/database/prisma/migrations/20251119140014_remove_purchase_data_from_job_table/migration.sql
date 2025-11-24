/*
  Warnings:

  - You are about to drop the column `errorNote` on the `Job` table. All the data in the column will be lost.
  - You are about to drop the column `errorNoteKey` on the `Job` table. All the data in the column will be lost.
  - You are about to drop the column `nextAction` on the `Job` table. All the data in the column will be lost.
  - You are about to drop the column `nextActionErrorNote` on the `Job` table. All the data in the column will be lost.
  - You are about to drop the column `nextActionErrorType` on the `Job` table. All the data in the column will be lost.
  - You are about to drop the column `onChainStatus` on the `Job` table. All the data in the column will be lost.
  - You are about to drop the column `onChainTransactionHash` on the `Job` table. All the data in the column will be lost.
  - You are about to drop the column `onChainTransactionStatus` on the `Job` table. All the data in the column will be lost.
  - You are about to drop the column `purchaseId` on the `Job` table. All the data in the column will be lost.
  - You are about to drop the column `resultHash` on the `Job` table. All the data in the column will be lost.
  - You are about to drop the column `resultSubmittedAt` on the `Job` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Job" DROP COLUMN "errorNote",
DROP COLUMN "errorNoteKey",
DROP COLUMN "nextAction",
DROP COLUMN "nextActionErrorNote",
DROP COLUMN "nextActionErrorType",
DROP COLUMN "onChainStatus",
DROP COLUMN "onChainTransactionHash",
DROP COLUMN "onChainTransactionStatus",
DROP COLUMN "purchaseId",
DROP COLUMN "resultHash",
DROP COLUMN "resultSubmittedAt";
