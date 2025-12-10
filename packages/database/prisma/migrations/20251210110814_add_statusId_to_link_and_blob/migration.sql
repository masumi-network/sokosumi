/*
  Warnings:

  - Made the column `jobStatusId` on table `link` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
-- Make both jobStatusId and jobInputId nullable (at least one should be set, but both can be null)
ALTER TABLE "blob" ALTER COLUMN "jobStatusId" DROP NOT NULL;
ALTER TABLE "blob" ALTER COLUMN "jobInputId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "link" ALTER COLUMN "jobStatusId" SET NOT NULL;
