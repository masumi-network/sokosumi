/*
  Warnings:

  - You are about to drop the column `permission` on the `share` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "public"."share" DROP COLUMN "permission";

-- DropEnum
DROP TYPE "public"."SharePermission";

-- CreateIndex
CREATE INDEX "share_recipientOrganizationId_idx" ON "public"."share"("recipientOrganizationId");

-- CreateIndex
CREATE INDEX "share_recipientId_idx" ON "public"."share"("recipientId");
