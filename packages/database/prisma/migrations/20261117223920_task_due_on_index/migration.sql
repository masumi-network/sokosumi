-- CreateIndex
-- SOKD-277: the Task interest overdue sweep reads Tasks due in the last three
-- days across all workspaces every quarter hour, so no index leading with
-- "workspaceId" or "ownerId" can serve it.
--
-- CONCURRENTLY: the old Core instance keeps serving while this runs, and a
-- plain build takes a write lock on the task table for its duration. Its own
-- migration: CONCURRENTLY cannot share a transaction with another statement.
CREATE INDEX CONCURRENTLY "task_dueOn_idx" ON "task"("dueOn");
