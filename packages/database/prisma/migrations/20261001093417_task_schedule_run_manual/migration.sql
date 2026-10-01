-- Run now (ADR 0047): a Run released by hand, outside the rule.
ALTER TABLE "task_schedule_run" ADD COLUMN "manual" BOOLEAN NOT NULL DEFAULT false;

-- A manual Run is released the moment it is created; it is never planned,
-- skipped, moved, or canceled.
ALTER TABLE "task_schedule_run"
  ADD CONSTRAINT "task_schedule_run_manual_released_check" CHECK (
    NOT "manual" OR "state" = 'RELEASED'
  );
