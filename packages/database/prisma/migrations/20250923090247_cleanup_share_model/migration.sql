/*
  Warnings:

  - You are about to drop the column `permission` on the `share` table. All the data in the column will be lost.
  - You are about to drop the column `recipientId` on the `share` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "public"."share" DROP CONSTRAINT "share_recipientId_fkey";

-- DropIndex
DROP INDEX "public"."share_jobId_recipientId_key";

-- AlterTable
ALTER TABLE "public"."share" DROP COLUMN "permission",
DROP COLUMN "recipientId";

-- DropEnum
DROP TYPE "public"."SharePermission";

-- CreateIndex
CREATE INDEX "share_recipientOrganizationId_idx" ON "public"."share"("recipientOrganizationId");
