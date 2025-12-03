/*
  Warnings:

  - A unique constraint covering the columns `[jobEventId,sourceUrl]` on the table `blob` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "blob_jobEventId_sourceUrl_key" ON "blob"("jobEventId", "sourceUrl");
