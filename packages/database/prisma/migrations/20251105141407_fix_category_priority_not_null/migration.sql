/*
  Warnings:

  - Made the column `priority` on table `Category` required. This step will fail if there are existing NULL values in that column.

*/
-- Set default priority for any existing NULL values
UPDATE "Category" SET "priority" = 9999 WHERE "priority" IS NULL;

-- AlterTable
ALTER TABLE "Category" ALTER COLUMN "priority" SET NOT NULL;
