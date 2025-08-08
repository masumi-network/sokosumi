/*
  Warnings:

  - You are about to drop the column `requiredEmailDomains` on the `organization` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "public"."organization" DROP COLUMN "requiredEmailDomains";
