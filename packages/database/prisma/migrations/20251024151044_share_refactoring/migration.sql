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

-- DropTable
DROP TABLE "public"."share";

-- CreateTable
CREATE TABLE "jobShare" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "jobId" TEXT NOT NULL,
    "organizationId" TEXT,
    "token" TEXT,
    "allowSearchIndexing" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "jobShare_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "jobShare_jobId_key" ON "jobShare"("jobId");

-- CreateIndex
CREATE UNIQUE INDEX "jobShare_token_key" ON "jobShare"("token");

-- CreateIndex
CREATE INDEX "jobShare_organizationId_idx" ON "jobShare"("organizationId");

-- AddForeignKey
ALTER TABLE "jobShare" ADD CONSTRAINT "jobShare_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jobShare" ADD CONSTRAINT "jobShare_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
