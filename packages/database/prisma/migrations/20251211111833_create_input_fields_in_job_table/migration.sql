/*
  Warnings:

  - A unique constraint covering the columns `[jobId,sourceUrl]` on the table `blob` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "input" TEXT,
ADD COLUMN     "inputHash" TEXT,
ADD COLUMN     "inputSchema" TEXT;

-- AlterTable
ALTER TABLE "blob" ADD COLUMN     "jobId" TEXT;

-- CreateIndex
CREATE INDEX "blob_jobId_origin_idx" ON "blob"("jobId", "origin");

-- CreateIndex
CREATE UNIQUE INDEX "blob_jobId_sourceUrl_key" ON "blob"("jobId", "sourceUrl");

-- AddForeignKey
ALTER TABLE "blob" ADD CONSTRAINT "blob_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;
