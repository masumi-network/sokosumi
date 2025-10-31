/*
  Warnings:

  - Made the column `payByTime` on table `Job` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "Job" ALTER COLUMN "payByTime" SET NOT NULL;
