-- AlterTable: Rename creatorId to userId
ALTER TABLE "share" RENAME COLUMN "creatorId" TO "userId";

-- CreateIndex: Add unique constraint on jobId and userId
CREATE UNIQUE INDEX "share_jobId_userId_key" ON "share"("jobId", "userId");

