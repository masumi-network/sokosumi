/*
  Warnings:

  - You are about to drop the `share` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "public"."share" DROP CONSTRAINT "share_creatorId_fkey";

-- DropForeignKey
ALTER TABLE "public"."share" DROP CONSTRAINT "share_jobId_fkey";

-- DropForeignKey
ALTER TABLE "public"."share" DROP CONSTRAINT "share_recipientOrganizationId_fkey";

-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "isOrganizationShared" BOOLEAN NOT NULL DEFAULT false;

-- DropTable
DROP TABLE "public"."share";

-- CreateTable
CREATE TABLE "jobPublicShare" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "jobId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "allowSearchIndexing" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "jobPublicShare_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "jobPublicShare_jobId_key" ON "jobPublicShare"("jobId");

-- CreateIndex
CREATE UNIQUE INDEX "jobPublicShare_token_key" ON "jobPublicShare"("token");

-- AddForeignKey
ALTER TABLE "jobPublicShare" ADD CONSTRAINT "jobPublicShare_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;
