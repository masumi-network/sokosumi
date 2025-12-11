/*
  Warnings:

  - Made the column `input` on table `Job` required. This step will fail if there are existing NULL values in that column.
  - Made the column `inputSchema` on table `Job` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "Job" ALTER COLUMN "input" SET NOT NULL,
ALTER COLUMN "inputSchema" SET NOT NULL;
