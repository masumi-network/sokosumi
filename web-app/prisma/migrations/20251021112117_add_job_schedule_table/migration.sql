-- Create Enum
CREATE TYPE "ScheduleType" AS ENUM ('ONE_TIME', 'CRON');

-- CreateTable
CREATE TABLE "jobSchedule" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT,
    "agentId" TEXT NOT NULL,
    "scheduleType" "ScheduleType" NOT NULL,
    "cron" TEXT,
    "oneTimeAtUtc" TIMESTAMP(3),
    "timezone" TEXT NOT NULL,
    "endOnUtc" TIMESTAMP(3),
    "endAfterOccurrences" INTEGER,
    "inputSchema" JSONB NOT NULL,
    "input" TEXT NOT NULL,
    "maxAcceptedCents" BIGINT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "nextRunAt" TIMESTAMP(3),
    "pauseReason" TEXT,

    CONSTRAINT "jobSchedule_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "jobSchedule_schedule_fields_check" CHECK (
        ("scheduleType" = 'CRON' AND "cron" IS NOT NULL AND "oneTimeAtUtc" IS NULL) OR
        ("scheduleType" = 'ONE_TIME' AND "oneTimeAtUtc" IS NOT NULL AND "cron" IS NULL)
    )
);

-- CreateIndex
CREATE INDEX "jobSchedule_isActive_nextRunAt_idx" ON "jobSchedule"("isActive", "nextRunAt");

-- CreateIndex
CREATE INDEX "jobSchedule_agentId_idx" ON "jobSchedule"("agentId");

-- AddForeignKey
ALTER TABLE "jobSchedule" ADD CONSTRAINT "jobSchedule_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jobSchedule" ADD CONSTRAINT "jobSchedule_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jobSchedule" ADD CONSTRAINT "jobSchedule_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "Job" ADD COLUMN "jobScheduleId" TEXT;

-- CreateIndex
CREATE INDEX "Job_jobScheduleId_idx" ON "Job"("jobScheduleId");

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_jobScheduleId_fkey" FOREIGN KEY ("jobScheduleId") REFERENCES "jobSchedule"("id") ON DELETE SET NULL ON UPDATE CASCADE;
