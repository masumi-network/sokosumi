-- CreateIndex
-- CONCURRENTLY: the old Core instance keeps serving while this runs, and a
-- plain build takes a write lock on the notification table for its duration.
CREATE INDEX CONCURRENTLY "notification_kind_referenceId_idx" ON "notification"("kind", "referenceId");
