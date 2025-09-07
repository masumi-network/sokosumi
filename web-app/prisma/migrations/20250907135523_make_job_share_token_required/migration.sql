/*
  Warnings:

  - Made the column `token` on table `share` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "public"."share" ALTER COLUMN "token" SET NOT NULL;
