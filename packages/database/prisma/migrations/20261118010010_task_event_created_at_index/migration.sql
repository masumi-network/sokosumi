-- CreateIndex
-- SOKD-277: the Task interest sync reads the last 48 hours of settled Task
-- events across all Tasks every minute, so no index leading with "taskId"
-- can serve it. Without this it scans the whole taskEvent table each tick.
--
-- CONCURRENTLY: the old Core instance keeps serving while this runs, and a
-- plain build takes a write lock on the taskEvent table for its duration.
CREATE INDEX CONCURRENTLY "taskEvent_createdAt_idx" ON "taskEvent"("createdAt");
