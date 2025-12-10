/*
  Warnings:

  - A unique constraint covering the columns `[jobStatusId,sourceUrl]` on the table `blob` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[jobInputId,sourceUrl]` on the table `blob` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[jobStatusId,url]` on the table `link` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "blob" ADD COLUMN     "jobInputId" TEXT,
ADD COLUMN     "jobStatusId" TEXT;

-- AlterTable
ALTER TABLE "link" ADD COLUMN     "jobStatusId" TEXT;

-- CreateTable
CREATE TABLE "jobStatus" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "externalId" TEXT,
    "jobId" TEXT NOT NULL,
    "inputId" TEXT,
    "status" "AgentJobStatus" NOT NULL DEFAULT 'AWAITING_PAYMENT',
    "inputSchema" TEXT,
    "result" TEXT,

    CONSTRAINT "jobStatus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "jobInput" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "externalId" TEXT,
    "jobId" TEXT NOT NULL,
    "inputSchema" TEXT,
    "input" TEXT NOT NULL,
    "inputHash" TEXT,
    "signature" TEXT,

    CONSTRAINT "jobInput_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "jobStatus_inputId_key" ON "jobStatus"("inputId");

-- CreateIndex
CREATE INDEX "jobStatus_externalId_idx" ON "jobStatus"("externalId");

-- CreateIndex
CREATE INDEX "jobStatus_jobId_idx" ON "jobStatus"("jobId");

-- CreateIndex
CREATE INDEX "jobInput_externalId_idx" ON "jobInput"("externalId");

-- CreateIndex
CREATE INDEX "jobInput_jobId_idx" ON "jobInput"("jobId");

-- CreateIndex
CREATE INDEX "blob_jobStatusId_origin_idx" ON "blob"("jobStatusId", "origin");

-- CreateIndex
CREATE INDEX "blob_jobInputId_origin_idx" ON "blob"("jobInputId", "origin");

-- CreateIndex
CREATE UNIQUE INDEX "blob_jobStatusId_sourceUrl_key" ON "blob"("jobStatusId", "sourceUrl");

-- CreateIndex
CREATE UNIQUE INDEX "blob_jobInputId_sourceUrl_key" ON "blob"("jobInputId", "sourceUrl");

-- CreateIndex
CREATE INDEX "link_jobStatusId_idx" ON "link"("jobStatusId");

-- CreateIndex
CREATE UNIQUE INDEX "link_jobStatusId_url_key" ON "link"("jobStatusId", "url");

-- AddForeignKey
ALTER TABLE "jobStatus" ADD CONSTRAINT "jobStatus_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jobStatus" ADD CONSTRAINT "jobStatus_inputId_fkey" FOREIGN KEY ("inputId") REFERENCES "jobInput"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jobInput" ADD CONSTRAINT "jobInput_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blob" ADD CONSTRAINT "blob_jobStatusId_fkey" FOREIGN KEY ("jobStatusId") REFERENCES "jobStatus"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blob" ADD CONSTRAINT "blob_jobInputId_fkey" FOREIGN KEY ("jobInputId") REFERENCES "jobInput"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "link" ADD CONSTRAINT "link_jobStatusId_fkey" FOREIGN KEY ("jobStatusId") REFERENCES "jobStatus"("id") ON DELETE CASCADE ON UPDATE CASCADE;
