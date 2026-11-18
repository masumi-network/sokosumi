-- CreateIndex
-- SOKD-279: a Task's sub-tasks in checklist order.
--
-- CONCURRENTLY: the old Core instance keeps serving while this runs, and a
-- plain build takes a write lock on the task table for its duration. Its own
-- migration: CONCURRENTLY cannot share a transaction with another statement.
CREATE INDEX CONCURRENTLY "task_parentTaskId_archivedAt_position_id_idx" ON "task"("parentTaskId", "archivedAt", "position", "id");
