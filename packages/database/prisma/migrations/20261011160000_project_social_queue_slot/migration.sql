-- CreateTable
CREATE TABLE "project_social_queue_slot" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "projectId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "weekday" INTEGER NOT NULL,
    "minutesFromMidnight" INTEGER NOT NULL,
    "timezone" TEXT NOT NULL,

    CONSTRAINT "project_social_queue_slot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "project_social_queue_slot_project_id_weekday_minutes_key" ON "project_social_queue_slot"("projectId", "weekday", "minutesFromMidnight");

-- CreateIndex
CREATE INDEX "project_social_queue_slot_projectId_idx" ON "project_social_queue_slot"("projectId");

-- AddForeignKey
ALTER TABLE "project_social_queue_slot" ADD CONSTRAINT "project_social_queue_slot_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "project_social_queue_slot"
  ADD CONSTRAINT "project_social_queue_slot_weekday_check"
  CHECK ("weekday" >= 0 AND "weekday" <= 6);

ALTER TABLE "project_social_queue_slot"
  ADD CONSTRAINT "project_social_queue_slot_minutes_check"
  CHECK ("minutesFromMidnight" >= 0 AND "minutesFromMidnight" <= 1439);
