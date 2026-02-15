/*
  Warnings:

  - A unique constraint covering the columns `[jobInputId,url]` on the table `attachment` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "attachment_jobInputId_url_key";

-- CreateIndex
CREATE UNIQUE INDEX "attachment_jobInputId_url_key" ON "attachment"("jobInputId", "url");

