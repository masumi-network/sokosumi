-- AlterTable
ALTER TABLE "task" ADD COLUMN     "contactId" UUID;

-- CreateIndex
CREATE INDEX "task_contactId_idx" ON "task"("contactId");

-- AddForeignKey
ALTER TABLE "task" ADD CONSTRAINT "task_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
