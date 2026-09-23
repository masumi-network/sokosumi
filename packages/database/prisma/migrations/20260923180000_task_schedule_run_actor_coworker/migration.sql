-- ADR 0040: Run exceptions are recorded on the Run row, not as Task events,
-- so the row also names a Coworker vendor that made one.

-- AlterTable
ALTER TABLE "task_schedule_occurrence" ADD COLUMN "actorCoworkerId" TEXT;

-- CreateIndex
CREATE INDEX "task_schedule_occurrence_actorCoworkerId_idx" ON "task_schedule_occurrence"("actorCoworkerId");

-- AddForeignKey
ALTER TABLE "task_schedule_occurrence" ADD CONSTRAINT "task_schedule_occurrence_actorCoworkerId_fkey" FOREIGN KEY ("actorCoworkerId") REFERENCES "coworker"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "task_schedule_occurrence" ADD CONSTRAINT "task_schedule_occurrence_actor_at_most_one_check" CHECK (
  "actorUserId" IS NULL OR "actorCoworkerId" IS NULL
);
