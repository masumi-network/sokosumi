-- DropForeignKey
ALTER TABLE "jobInput" DROP CONSTRAINT "jobInput_statusId_fkey";

-- AddForeignKey
ALTER TABLE "jobInput" ADD CONSTRAINT "jobInput_statusId_fkey" FOREIGN KEY ("statusId") REFERENCES "jobStatus"("id") ON DELETE CASCADE ON UPDATE CASCADE;
