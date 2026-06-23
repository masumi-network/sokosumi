-- AlterTable
ALTER TABLE "task" ADD COLUMN "metadata" TEXT,
ADD COLUMN "nextRunAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "task_status_nextRunAt_idx" ON "task"("status", "nextRunAt");
