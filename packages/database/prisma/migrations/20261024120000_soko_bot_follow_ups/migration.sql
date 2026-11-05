-- AlterTable
ALTER TABLE "soko_bot_delegation" ADD COLUMN     "followUp" TEXT,
ADD COLUMN     "followUpTurnId" UUID;

-- AlterTable
ALTER TABLE "soko_bot_schedule" ADD COLUMN     "jobId" TEXT,
ADD COLUMN     "taskId" TEXT;

-- CreateIndex
CREATE INDEX "soko_bot_schedule_taskId_idx" ON "soko_bot_schedule"("taskId");

-- CreateIndex
CREATE INDEX "soko_bot_schedule_jobId_idx" ON "soko_bot_schedule"("jobId");

-- AddForeignKey
ALTER TABLE "soko_bot_schedule" ADD CONSTRAINT "soko_bot_schedule_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "soko_bot_schedule" ADD CONSTRAINT "soko_bot_schedule_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;
