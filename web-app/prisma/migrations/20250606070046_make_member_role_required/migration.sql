/*
  Warnings:

  - Made the column `role` on table `member` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "member" ALTER COLUMN "role" SET NOT NULL;
