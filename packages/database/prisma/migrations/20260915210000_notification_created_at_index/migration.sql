-- CreateIndex
-- SOK-916: the follow-up sync reads day-old notifications across all users, so
-- no index leading with "userId" can serve it. Without this it scans the whole
-- notification table once an hour.
--
-- CONCURRENTLY: the old Core instance keeps serving while this runs, and a
-- plain build takes a write lock on the notification table for its duration.
CREATE INDEX CONCURRENTLY "notification_createdAt_idx" ON "notification"("createdAt");
