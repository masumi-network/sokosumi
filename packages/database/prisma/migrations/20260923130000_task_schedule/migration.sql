-- ADR 0041 expand step: additive only. Existing schedule columns stay until
-- the cutover migration moves series into task_schedule.

-- CreateEnum
CREATE TYPE "TaskScheduleState" AS ENUM ('ACTIVE', 'PAUSED', 'ENDED');

-- CreateEnum
CREATE TYPE "TaskScheduleEndsMode" AS ENUM ('NEVER', 'ON', 'AFTER');

-- AlterTable
ALTER TABLE "task" ADD COLUMN     "runAt" TIMESTAMP(3),
ADD COLUMN     "scheduleId" UUID;

-- AlterTable
ALTER TABLE "task_schedule_occurrence" ADD COLUMN     "scheduleId" UUID;

-- CreateTable
CREATE TABLE "task_schedule" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "workspaceId" UUID NOT NULL,
    "organizationId" TEXT,
    "ownerId" TEXT NOT NULL,
    "creatorUserId" TEXT,
    "creatorCoworkerId" TEXT,
    "creatorSokoBotId" UUID,
    "state" "TaskScheduleState" NOT NULL DEFAULT 'ACTIVE',
    "expr" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "intervalDays" INTEGER,
    "anchorAt" TIMESTAMP(3) NOT NULL,
    "ruleEffectiveFrom" TIMESTAMP(3) NOT NULL,
    "endsMode" "TaskScheduleEndsMode" NOT NULL DEFAULT 'NEVER',
    "endsOn" TIMESTAMP(3),
    "targetRunCount" INTEGER,
    "releasedCount" INTEGER NOT NULL DEFAULT 0,
    "nextRunAt" TIMESTAMP(3),
    "revision" INTEGER NOT NULL DEFAULT 0,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "projectId" UUID,
    "visibility" "TaskVisibility" NOT NULL DEFAULT 'PUBLIC',
    "assigneeId" TEXT,
    "assigneeSokoBotId" UUID,
    "assigneeUserId" TEXT,

    CONSTRAINT "task_schedule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "task_schedule_state_nextRunAt_idx" ON "task_schedule"("state", "nextRunAt");

-- CreateIndex
CREATE INDEX "task_schedule_workspaceId_createdAt_id_idx" ON "task_schedule"("workspaceId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "task_schedule_projectId_idx" ON "task_schedule"("projectId");

-- CreateIndex
CREATE INDEX "task_schedule_organizationId_idx" ON "task_schedule"("organizationId");

-- CreateIndex
CREATE INDEX "task_schedule_ownerId_idx" ON "task_schedule"("ownerId");

-- CreateIndex
CREATE INDEX "task_schedule_creatorUserId_idx" ON "task_schedule"("creatorUserId");

-- CreateIndex
CREATE INDEX "task_schedule_creatorCoworkerId_idx" ON "task_schedule"("creatorCoworkerId");

-- CreateIndex
CREATE INDEX "task_schedule_creatorSokoBotId_idx" ON "task_schedule"("creatorSokoBotId");

-- CreateIndex
CREATE INDEX "task_schedule_assigneeId_idx" ON "task_schedule"("assigneeId");

-- CreateIndex
CREATE INDEX "task_schedule_assigneeSokoBotId_idx" ON "task_schedule"("assigneeSokoBotId");

-- CreateIndex
CREATE INDEX "task_schedule_assigneeUserId_idx" ON "task_schedule"("assigneeUserId");

-- CreateIndex
CREATE INDEX "task_scheduleId_idx" ON "task"("scheduleId");

-- CreateIndex
CREATE INDEX "task_schedule_occurrence_schedule_effective_id_idx" ON "task_schedule_occurrence"("scheduleId", "effectiveScheduledAt", "id");

-- AddForeignKey
ALTER TABLE "task" ADD CONSTRAINT "task_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "task_schedule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_schedule" ADD CONSTRAINT "task_schedule_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_schedule" ADD CONSTRAINT "task_schedule_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_schedule" ADD CONSTRAINT "task_schedule_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_schedule" ADD CONSTRAINT "task_schedule_creatorUserId_fkey" FOREIGN KEY ("creatorUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_schedule" ADD CONSTRAINT "task_schedule_creatorCoworkerId_fkey" FOREIGN KEY ("creatorCoworkerId") REFERENCES "coworker"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_schedule" ADD CONSTRAINT "task_schedule_creatorSokoBotId_fkey" FOREIGN KEY ("creatorSokoBotId") REFERENCES "soko_bot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_schedule" ADD CONSTRAINT "task_schedule_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_schedule" ADD CONSTRAINT "task_schedule_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "coworker"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_schedule" ADD CONSTRAINT "task_schedule_assigneeSokoBotId_fkey" FOREIGN KEY ("assigneeSokoBotId") REFERENCES "soko_bot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_schedule" ADD CONSTRAINT "task_schedule_assigneeUserId_fkey" FOREIGN KEY ("assigneeUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_schedule_occurrence" ADD CONSTRAINT "task_schedule_occurrence_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "task_schedule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Same invariants as task: exactly one creator, at most one assignee.
ALTER TABLE "task_schedule" ADD CONSTRAINT "task_schedule_creator_exactly_one_check" CHECK (
  (
    ("creatorUserId" IS NOT NULL)::int
    + ("creatorCoworkerId" IS NOT NULL)::int
    + ("creatorSokoBotId" IS NOT NULL)::int
  ) = 1
);

ALTER TABLE "task_schedule" ADD CONSTRAINT "task_schedule_assignee_at_most_one_check" CHECK (
  (CASE WHEN "assigneeId" IS NOT NULL THEN 1 ELSE 0 END)
  + (CASE WHEN "assigneeSokoBotId" IS NOT NULL THEN 1 ELSE 0 END)
  + (CASE WHEN "assigneeUserId" IS NOT NULL THEN 1 ELSE 0 END)
  <= 1
);

-- The end rule carries exactly the field its mode needs.
ALTER TABLE "task_schedule" ADD CONSTRAINT "task_schedule_end_rule_check" CHECK (
  ("endsMode" = 'NEVER' AND "endsOn" IS NULL AND "targetRunCount" IS NULL)
  OR ("endsMode" = 'ON' AND "endsOn" IS NOT NULL AND "targetRunCount" IS NULL)
  OR ("endsMode" = 'AFTER' AND "endsOn" IS NULL AND "targetRunCount" > 0)
);

ALTER TABLE "task_schedule" ADD CONSTRAINT "task_schedule_counts_check" CHECK (
  "releasedCount" >= 0
  AND ("intervalDays" IS NULL OR "intervalDays" > 0)
);
