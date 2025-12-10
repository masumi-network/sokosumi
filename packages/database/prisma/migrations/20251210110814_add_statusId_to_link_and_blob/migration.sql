/*
  Warnings:

  - Made the column `jobStatusId` on table `blob` required. This step will fail if there are existing NULL values in that column.
  - Made the column `jobStatusId` on table `link` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "blob" ALTER COLUMN "jobStatusId" SET NOT NULL;

-- AlterTable
ALTER TABLE "link" ALTER COLUMN "jobStatusId" SET NOT NULL;
