/*
  Warnings:

  - You are about to drop the column `paymentId` on the `Job` table. All the data in the column will be lost.

  Steps:
  1. Add purchaseId as nullable
  2. Copy data from paymentId to purchaseId
  3. Drop paymentId
*/
-- AlterTable
ALTER TABLE "Job" ADD COLUMN "purchaseId" TEXT;
UPDATE "Job" SET "purchaseId" = "paymentId";
ALTER TABLE "Job" DROP COLUMN "paymentId";
