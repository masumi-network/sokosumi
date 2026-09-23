-- ADR 0041 expand step: Task Schedule Occurrences live in the existing ledger
-- beside the old series rows until the cutover migration re-parents them.

-- The rule epoch of each schedule. Rows from before this migration get a fresh
-- epoch; they have no Occurrences yet.
ALTER TABLE "task_schedule" ADD COLUMN "epochId" UUID NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE "task_schedule" ALTER COLUMN "epochId" DROP DEFAULT;

-- A Task Schedule Occurrence has no series Task.
ALTER TABLE "task_schedule_occurrence" ALTER COLUMN "seriesTaskId" DROP NOT NULL;

ALTER TABLE "task_schedule_occurrence" ADD CONSTRAINT "task_schedule_occurrence_parent_check" CHECK (
  ("seriesTaskId" IS NULL) <> ("scheduleId" IS NULL)
);

-- One Occurrence per schedule, rule epoch, and rule time, so a repeated
-- projection never plans (and releases) the same Occurrence twice.
CREATE UNIQUE INDEX "task_schedule_occurrence_schedule_epoch_original_key" ON "task_schedule_occurrence"("scheduleId", "epochId", "originalScheduledAt");
