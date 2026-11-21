-- SOKD-279: check the sub-task constraints added NOT VALID. VALIDATE takes a
-- lock that lets reads and writes through, so the deploy keeps serving.
ALTER TABLE "task" VALIDATE CONSTRAINT "task_parentTaskId_fkey";
ALTER TABLE "task" VALIDATE CONSTRAINT "task_subtask_position_check";
