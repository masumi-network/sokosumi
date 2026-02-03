-- AlterTable
ALTER TABLE "Job" ADD COLUMN "taskId" TEXT;

-- CreateIndex
CREATE INDEX "Job_taskId_idx" ON "Job"("taskId");

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "task"("id") ON DELETE SET NULL ON UPDATE CASCADE;
