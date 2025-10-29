/*
  Warnings:

  - You are about to drop the column `centsPerAmount` on the `FiatTransaction` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "FiatTransaction" DROP COLUMN "centsPerAmount",
ALTER COLUMN "cents" DROP DEFAULT;
