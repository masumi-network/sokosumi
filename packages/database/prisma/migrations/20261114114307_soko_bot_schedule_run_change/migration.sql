-- CreateTable
CREATE TABLE "soko_bot_schedule_run_change" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "scheduleId" UUID NOT NULL,
    "originalAt" TIMESTAMP(3) NOT NULL,
    "scheduledAt" TIMESTAMP(3),

    CONSTRAINT "soko_bot_schedule_run_change_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "soko_bot_schedule_run_change_originalAt_idx" ON "soko_bot_schedule_run_change"("originalAt");

-- CreateIndex
CREATE UNIQUE INDEX "soko_bot_schedule_run_change_scheduleId_originalAt_key" ON "soko_bot_schedule_run_change"("scheduleId", "originalAt");

-- AddForeignKey
ALTER TABLE "soko_bot_schedule_run_change" ADD CONSTRAINT "soko_bot_schedule_run_change_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "soko_bot_schedule"("id") ON DELETE CASCADE ON UPDATE CASCADE;
